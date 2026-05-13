package coverletter

import (
	"context"
	"errors"
	"strings"
	"time"

	"hh-personal-applier/internal/llm"
	"hh-personal-applier/internal/storage"
)

type Store interface {
	GetSettings(ctx context.Context) (storage.Settings, error)
	GetRunSettings(ctx context.Context, runID string) (storage.Settings, error)
	CreateCoverLetter(ctx context.Context, create storage.CoverLetterCreate) (storage.CoverLetter, bool, error)
	GetCoverLetter(ctx context.Context, vacancyID string, now time.Time) (storage.CoverLetter, error)
	ResolveCoverLetter(ctx context.Context, vacancyID string, status storage.CoverLetterStatus, now time.Time) (storage.CoverLetter, bool, error)
	QueueLLMRateLimitAlert(ctx context.Context, runID string) error
}

type Config struct {
	Now          func() time.Time
	TTL          time.Duration
	MaxAttempts  int
	CandidateBio string
}

type Service struct {
	store        Store
	provider     llm.Provider
	now          func() time.Time
	ttl          time.Duration
	maxAttempts  int
	candidateBio string
}

func NewService(store Store, provider llm.Provider, cfg Config) *Service {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.TTL <= 0 {
		cfg.TTL = time.Hour
	}
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 3
	}
	return &Service{
		store:        store,
		provider:     provider,
		now:          cfg.Now,
		ttl:          cfg.TTL,
		maxAttempts:  cfg.MaxAttempts,
		candidateBio: cfg.CandidateBio,
	}
}

func (s *Service) Request(ctx context.Context, request storage.CoverLetterRequest) (storage.CoverLetter, error) {
	if err := validateRequest(request); err != nil {
		return storage.CoverLetter{}, err
	}

	vacancyID := strings.TrimSpace(request.VacancyID)
	existing, err := s.store.GetCoverLetter(ctx, vacancyID, s.now())
	if err == nil {
		return existing, nil
	}
	if !isNotFound(err) {
		return storage.CoverLetter{}, err
	}

	settings, err := s.settingsForRequest(ctx, request.RunID)
	if err != nil {
		return storage.CoverLetter{}, err
	}

	language := llm.DetectLanguage(request.VacancyTitle + "\n" + request.VacancyDescription)
	messages := llm.BuildCoverLetterMessages(llm.CoverLetterPromptInput{
		Language:           language,
		CandidateBio:       s.candidateBio,
		VacancyTitle:       request.VacancyTitle,
		VacancyDescription: request.VacancyDescription,
	})

	body, err := s.generateGuarded(ctx, messages, language)
	if err != nil {
		if llm.IsRateLimit(err) {
			if queueErr := s.store.QueueLLMRateLimitAlert(ctx, request.RunID); queueErr != nil {
				return storage.CoverLetter{}, queueErr
			}
			return storage.CoverLetter{}, storage.NewRateLimited("llm_rate_limited", "LLM provider rate limit reached")
		}
		return storage.CoverLetter{}, err
	}

	status := storage.CoverLetterStatusApproved
	if settings.RequireCoverLetterApproval {
		status = storage.CoverLetterStatusPendingApproval
	}
	letter, _, err := s.store.CreateCoverLetter(ctx, storage.CoverLetterCreate{
		VacancyID:    strings.TrimSpace(request.VacancyID),
		VacancyTitle: strings.TrimSpace(request.VacancyTitle),
		VacancyURL:   strings.TrimSpace(request.VacancyURL),
		Body:         body,
		Language:     storage.CoverLetterLanguage(language),
		Status:       status,
		ExpiresAt:    s.now().Add(s.ttl),
	})
	return letter, err
}

func isNotFound(err error) bool {
	var opErr *storage.OpError
	return errors.As(err, &opErr) && opErr.Kind == storage.ErrorKindNotFound
}

func (s *Service) Get(ctx context.Context, vacancyID string) (storage.CoverLetter, error) {
	vacancyID = strings.TrimSpace(vacancyID)
	if vacancyID == "" {
		return storage.CoverLetter{}, storage.NewValidation("invalid_vacancy_id", "vacancyId is required")
	}
	return s.store.GetCoverLetter(ctx, vacancyID, s.now())
}

func (s *Service) ResolveCallback(ctx context.Context, callback storage.CoverLetterCallback) (storage.CoverLetterCallbackResult, error) {
	vacancyID := strings.TrimSpace(callback.VacancyID)
	if vacancyID == "" {
		return storage.CoverLetterCallbackResult{}, storage.NewValidation("invalid_vacancy_id", "vacancyId is required")
	}

	status := storage.CoverLetterStatusSkipped
	if callback.Action == storage.CoverLetterCallbackApprove {
		status = storage.CoverLetterStatusApproved
	}

	letter, changed, err := s.store.ResolveCoverLetter(ctx, vacancyID, status, s.now())
	if err != nil {
		return storage.CoverLetterCallbackResult{}, err
	}
	return storage.CoverLetterCallbackResult{Changed: changed, Letter: letter}, nil
}

func (s *Service) settingsForRequest(ctx context.Context, runID string) (storage.Settings, error) {
	if strings.TrimSpace(runID) != "" {
		return s.store.GetRunSettings(ctx, strings.TrimSpace(runID))
	}
	return s.store.GetSettings(ctx)
}

func (s *Service) generateGuarded(ctx context.Context, messages []llm.Message, language llm.Language) (string, error) {
	var lastErr error
	for attempt := 0; attempt < s.maxAttempts; attempt++ {
		body, err := s.provider.Generate(ctx, messages)
		if err != nil {
			return "", err
		}
		body = llm.CleanCoverLetter(body)
		if err := llm.ValidateCoverLetter(body, language); err != nil {
			lastErr = err
			continue
		}
		return body, nil
	}
	if lastErr != nil {
		return "", storage.NewValidation("cover_letter_guard_failed", lastErr.Error())
	}
	return "", storage.NewValidation("cover_letter_guard_failed", "cover letter generation failed")
}

func validateRequest(request storage.CoverLetterRequest) error {
	if strings.TrimSpace(request.VacancyID) == "" {
		return storage.NewValidation("invalid_vacancy_id", "vacancyId is required")
	}
	if strings.TrimSpace(request.VacancyTitle) == "" {
		return storage.NewValidation("invalid_vacancy_title", "vacancyTitle is required")
	}
	if strings.TrimSpace(request.VacancyDescription) == "" {
		return storage.NewValidation("invalid_vacancy_description", "vacancyDescription is required")
	}
	return nil
}
