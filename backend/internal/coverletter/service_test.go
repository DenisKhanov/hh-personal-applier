package coverletter

import (
	"context"
	"errors"
	"testing"
	"time"

	"hh-personal-applier/internal/llm"
	"hh-personal-applier/internal/storage"
)

func TestServiceRequestsLetterWithApprovalAndRetriesGuardFailures(t *testing.T) {
	store := newFakeStore()
	provider := &scriptedProvider{
		responses: []string{
			"Я начинающий разработчик. Рассмотрите мою кандидатуру.",
			"Здравствуйте! Мне интересна вакансия Go Backend Developer: я проектировал REST API, работал с PostgreSQL и Docker. Могу быть полезен в задачах, где важны надежный backend, понятные интерфейсы и аккуратная работа с данными.",
		},
	}
	service := NewService(store, provider, Config{
		Now:          func() time.Time { return fixedNow },
		TTL:          time.Hour,
		MaxAttempts:  3,
		CandidateBio: "Go backend developer",
	})

	letter, err := service.Request(context.Background(), storage.CoverLetterRequest{
		RunID:              "run-1",
		VacancyID:          "42",
		VacancyTitle:       "Go Backend Developer",
		VacancyDescription: "Нужен разработчик Go для REST API и PostgreSQL.",
		VacancyURL:         "https://hh.ru/vacancy/42",
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}

	if provider.calls != 2 {
		t.Fatalf("expected retry after guard failure, got %d provider calls", provider.calls)
	}
	if letter.Status != storage.CoverLetterStatusPendingApproval {
		t.Fatalf("expected pending approval, got %+v", letter)
	}
	if letter.Language != storage.CoverLetterLanguageRU {
		t.Fatalf("expected ru language, got %q", letter.Language)
	}
	if len(store.approvalNotifications) != 1 || store.approvalNotifications[0].VacancyID != "42" {
		t.Fatalf("expected one approval notification, got %+v", store.approvalNotifications)
	}
}

func TestServiceAutoApprovesWhenRunDoesNotRequireApproval(t *testing.T) {
	store := newFakeStore()
	store.settings.RequireCoverLetterApproval = false
	provider := &scriptedProvider{responses: []string{
		"Hello! I am interested in the Go Backend Developer role because it matches my backend API, PostgreSQL, and Docker experience. I can help build reliable services with clear interfaces and careful data handling.",
	}}
	service := NewService(store, provider, Config{
		Now:         func() time.Time { return fixedNow },
		TTL:         time.Hour,
		MaxAttempts: 3,
	})

	letter, err := service.Request(context.Background(), storage.CoverLetterRequest{
		RunID:              "run-1",
		VacancyID:          "84",
		VacancyTitle:       "Go Backend Developer",
		VacancyDescription: "Backend services with PostgreSQL.",
	})
	if err != nil {
		t.Fatalf("request: %v", err)
	}

	if letter.Status != storage.CoverLetterStatusApproved {
		t.Fatalf("expected approved auto-flow, got %+v", letter)
	}
	if len(store.approvalNotifications) != 0 {
		t.Fatalf("expected no approval notification, got %+v", store.approvalNotifications)
	}
}

func TestServiceReturnsExistingLetterWithoutCallingProvider(t *testing.T) {
	store := newFakeStore()
	store.letters["42"] = storage.CoverLetter{
		ID:        "letter-42",
		VacancyID: "42",
		Status:    storage.CoverLetterStatusPendingApproval,
		ExpiresAt: fixedNow.Add(time.Hour),
	}
	provider := &scriptedProvider{responses: []string{
		"Здравствуйте! Это письмо не должно генерироваться повторно.",
	}}
	service := NewService(store, provider, Config{
		Now: func() time.Time { return fixedNow },
		TTL: time.Hour,
	})

	letter, err := service.Request(context.Background(), storage.CoverLetterRequest{
		RunID:              "run-1",
		VacancyID:          "42",
		VacancyTitle:       "Go Backend Developer",
		VacancyDescription: "Нужен разработчик Go.",
	})
	if err != nil {
		t.Fatalf("request existing: %v", err)
	}
	if letter.ID != "letter-42" {
		t.Fatalf("expected existing letter, got %+v", letter)
	}
	if provider.calls != 0 {
		t.Fatalf("expected provider not to be called for existing letter, got %d", provider.calls)
	}
}

func TestServiceQueuesRateLimitAlertAndReturnsRateLimitedError(t *testing.T) {
	store := newFakeStore()
	provider := &scriptedProvider{err: llm.NewRateLimitError("rate limit")}
	service := NewService(store, provider, Config{
		Now:         func() time.Time { return fixedNow },
		TTL:         time.Hour,
		MaxAttempts: 3,
	})

	_, err := service.Request(context.Background(), storage.CoverLetterRequest{
		RunID:              "run-1",
		VacancyID:          "42",
		VacancyTitle:       "Go Backend Developer",
		VacancyDescription: "Нужен разработчик Go.",
	})
	if err == nil {
		t.Fatal("expected rate limited error")
	}
	var opErr *storage.OpError
	if !errors.As(err, &opErr) || opErr.Code != "llm_rate_limited" {
		t.Fatalf("expected llm_rate_limited op error, got %T %v", err, err)
	}
	if store.rateLimitAlerts != 1 {
		t.Fatalf("expected one rate limit alert, got %d", store.rateLimitAlerts)
	}
}

func TestServiceResolvesCallbacksIdempotently(t *testing.T) {
	store := newFakeStore()
	store.letters["42"] = storage.CoverLetter{
		ID:        "letter-1",
		VacancyID: "42",
		Status:    storage.CoverLetterStatusPendingApproval,
		ExpiresAt: fixedNow.Add(time.Hour),
	}
	service := NewService(store, &scriptedProvider{}, Config{
		Now: func() time.Time { return fixedNow },
	})

	first, err := service.ResolveCallback(context.Background(), storage.CoverLetterCallback{
		VacancyID: "42",
		Action:    storage.CoverLetterCallbackApprove,
	})
	if err != nil {
		t.Fatalf("first callback: %v", err)
	}
	if !first.Changed || first.Letter.Status != storage.CoverLetterStatusApproved {
		t.Fatalf("expected first callback to approve, got %+v", first)
	}

	second, err := service.ResolveCallback(context.Background(), storage.CoverLetterCallback{
		VacancyID: "42",
		Action:    storage.CoverLetterCallbackSkip,
	})
	if err != nil {
		t.Fatalf("second callback: %v", err)
	}
	if second.Changed || second.Letter.Status != storage.CoverLetterStatusApproved {
		t.Fatalf("expected second callback to be no-op, got %+v", second)
	}
}

func TestServiceTreatsEditCallbackAsSafeSkip(t *testing.T) {
	store := newFakeStore()
	store.letters["42"] = storage.CoverLetter{
		ID:        "letter-1",
		VacancyID: "42",
		Status:    storage.CoverLetterStatusPendingApproval,
		ExpiresAt: fixedNow.Add(time.Hour),
	}
	service := NewService(store, &scriptedProvider{}, Config{
		Now: func() time.Time { return fixedNow },
	})

	result, err := service.ResolveCallback(context.Background(), storage.CoverLetterCallback{
		VacancyID: "42",
		Action:    storage.CoverLetterCallbackEdit,
	})
	if err != nil {
		t.Fatalf("edit callback: %v", err)
	}
	if !result.Changed || result.Letter.Status != storage.CoverLetterStatusSkipped {
		t.Fatalf("expected edit callback to skip safely, got %+v", result)
	}
}

var fixedNow = time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)

type scriptedProvider struct {
	responses []string
	err       error
	calls     int
}

func (p *scriptedProvider) Generate(_ context.Context, _ []llm.Message) (string, error) {
	p.calls++
	if p.err != nil {
		return "", p.err
	}
	if len(p.responses) == 0 {
		return "", nil
	}
	response := p.responses[0]
	p.responses = p.responses[1:]
	return response, nil
}

type fakeStore struct {
	settings              storage.Settings
	letters               map[string]storage.CoverLetter
	approvalNotifications []storage.CoverLetterApprovalNotification
	rateLimitAlerts       int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		settings: storage.Settings{
			DailyLimit:                 100,
			RunLimit:                   25,
			PaceMinSeconds:             6,
			PaceMaxSeconds:             14,
			SkipWithTest:               true,
			SkipExternal:               true,
			RequireCoverLetterApproval: true,
			AutoApply:                  false,
		},
		letters: make(map[string]storage.CoverLetter),
	}
}

func (f *fakeStore) GetSettings(_ context.Context) (storage.Settings, error) {
	return f.settings, nil
}

func (f *fakeStore) GetRunSettings(_ context.Context, _ string) (storage.Settings, error) {
	return f.settings, nil
}

func (f *fakeStore) CreateCoverLetter(_ context.Context, create storage.CoverLetterCreate) (storage.CoverLetter, bool, error) {
	if existing, ok := f.letters[create.VacancyID]; ok {
		return existing, false, nil
	}
	letter := storage.CoverLetter{
		ID:             "letter-" + create.VacancyID,
		VacancyID:      create.VacancyID,
		VacancyTitle:   create.VacancyTitle,
		VacancyURL:     create.VacancyURL,
		Body:           create.Body,
		Language:       create.Language,
		Status:         create.Status,
		ExpiresAt:      create.ExpiresAt,
		CreatedAt:      fixedNow,
		ApprovalQueued: create.Status == storage.CoverLetterStatusPendingApproval,
	}
	f.letters[create.VacancyID] = letter
	if create.Status == storage.CoverLetterStatusPendingApproval {
		f.approvalNotifications = append(f.approvalNotifications, storage.CoverLetterApprovalNotification{
			VacancyID:    letter.VacancyID,
			VacancyTitle: letter.VacancyTitle,
			VacancyURL:   letter.VacancyURL,
			Body:         letter.Body,
			Language:     letter.Language,
			ExpiresAt:    letter.ExpiresAt,
		})
	}
	return letter, true, nil
}

func (f *fakeStore) GetCoverLetter(_ context.Context, vacancyID string, now time.Time) (storage.CoverLetter, error) {
	letter, ok := f.letters[vacancyID]
	if !ok {
		return storage.CoverLetter{}, storage.NewNotFound("cover_letter_not_found", "cover letter not found")
	}
	if letter.Status == storage.CoverLetterStatusPendingApproval && !letter.ExpiresAt.After(now) {
		letter.Status = storage.CoverLetterStatusExpired
		f.letters[vacancyID] = letter
	}
	return letter, nil
}

func (f *fakeStore) ResolveCoverLetter(_ context.Context, vacancyID string, status storage.CoverLetterStatus, now time.Time) (storage.CoverLetter, bool, error) {
	letter, err := f.GetCoverLetter(context.Background(), vacancyID, now)
	if err != nil {
		return storage.CoverLetter{}, false, err
	}
	if letter.Status != storage.CoverLetterStatusPendingApproval {
		return letter, false, nil
	}
	letter.Status = status
	f.letters[vacancyID] = letter
	return letter, true, nil
}

func (f *fakeStore) QueueLLMRateLimitAlert(_ context.Context, _ string) error {
	f.rateLimitAlerts++
	return nil
}
