package storage

import (
	"context"
	"encoding/json"
	"time"
)

type Store interface {
	GetSettings(ctx context.Context) (Settings, error)
	UpdateSettings(ctx context.Context, settings Settings) (Settings, error)
	StartRun(ctx context.Context, searchURL string) (Run, error)
	StopRun(ctx context.Context, runID string, reason string) (Run, error)
	ContinueRun(ctx context.Context, runID string) (Run, error)
	FilterCandidates(ctx context.Context, runID string, items []CandidateItem) (CandidatesResult, error)
	StartAttempt(ctx context.Context, attempt AttemptStart) (AttemptStartResult, error)
	FinalizeVacancyResult(ctx context.Context, result VacancyResult) (VacancyResultOutcome, error)
	GetTodayStats(ctx context.Context) (TodayStats, error)
	RecordEvent(ctx context.Context, event Event) error
	QueueTelegramTest(ctx context.Context) (NotificationQueueResult, error)
}

type NotificationKind string

const (
	NotificationKindCaptcha             NotificationKind = "captcha"
	NotificationKindError               NotificationKind = "error"
	NotificationKindDailyLimitReached   NotificationKind = "daily_limit_reached"
	NotificationKindCoverLetterApproval NotificationKind = "cover_letter_approval"
	NotificationKindDailyReport         NotificationKind = "daily_report"
	NotificationKindLoginLost           NotificationKind = "login_lost"
	NotificationKindTelegramTest        NotificationKind = "telegram_test"
)

type Notification struct {
	ID       string
	Kind     NotificationKind
	Payload  json.RawMessage
	Attempts int
}

type NotificationQueueResult struct {
	Queued bool `json:"queued"`
}

type Settings struct {
	DailyLimit                 int  `json:"dailyLimit"`
	RunLimit                   int  `json:"runLimit"`
	PaceMinSeconds             int  `json:"paceMinSeconds"`
	PaceMaxSeconds             int  `json:"paceMaxSeconds"`
	SkipWithTest               bool `json:"skipWithTest"`
	SkipExternal               bool `json:"skipExternal"`
	RequireCoverLetterApproval bool `json:"requireCoverLetterApproval"`
	AutoApply                  bool `json:"autoApply"`
}

func ValidateSettings(settings Settings) error {
	if settings.DailyLimit < 1 || settings.DailyLimit > 200 {
		return NewValidation("invalid_settings", "dailyLimit must be between 1 and 200")
	}
	if settings.RunLimit < 1 || settings.RunLimit > 100 {
		return NewValidation("invalid_settings", "runLimit must be between 1 and 100")
	}
	if settings.PaceMinSeconds < 5 || settings.PaceMinSeconds > 60 {
		return NewValidation("invalid_settings", "paceMinSeconds must be between 5 and 60")
	}
	if settings.PaceMaxSeconds < 5 || settings.PaceMaxSeconds > 180 {
		return NewValidation("invalid_settings", "paceMaxSeconds must be between 5 and 180")
	}
	if settings.PaceMinSeconds > settings.PaceMaxSeconds {
		return NewValidation("invalid_settings", "paceMinSeconds must be less than or equal to paceMaxSeconds")
	}
	return nil
}

type RunStatus string

const (
	RunStatusRunning       RunStatus = "running"
	RunStatusPausedCaptcha RunStatus = "paused_captcha"
	RunStatusPausedUnknown RunStatus = "paused_unknown"
	RunStatusPausedNetwork RunStatus = "paused_network"
	RunStatusStopped       RunStatus = "stopped"
	RunStatusCompleted     RunStatus = "completed"
)

type Run struct {
	ID               string    `json:"runId"`
	Status           RunStatus `json:"status"`
	SearchURL        string    `json:"searchUrl"`
	SettingsSnapshot Settings  `json:"settingsSnapshot"`
	AppliedCount     int       `json:"appliedCount"`
	SkippedCount     int       `json:"skippedCount"`
	ErrorCount       int       `json:"errorCount"`
	StopReason       string    `json:"stopReason,omitempty"`
}

func ValidateStopReason(reason string) error {
	switch reason {
	case "owner_stop",
		"manual_stop",
		"stopped",
		"no_more_vacancies",
		"daily_limit_reached",
		"run_limit_reached":
		return nil
	default:
		return NewValidation("invalid_stop_reason", "reason is not an allowed stop reason")
	}
}

func StopStatusForReason(reason string) RunStatus {
	switch reason {
	case "owner_stop", "manual_stop", "stopped":
		return RunStatusStopped
	default:
		return RunStatusCompleted
	}
}

func (r Run) IsActive() bool {
	return r.Status == RunStatusRunning || r.IsPaused()
}

func (r Run) IsPaused() bool {
	return r.Status == RunStatusPausedCaptcha ||
		r.Status == RunStatusPausedUnknown ||
		r.Status == RunStatusPausedNetwork
}

type ProcessedStatus string

const (
	ProcessedStatusAttempting            ProcessedStatus = "attempting"
	ProcessedStatusApplied               ProcessedStatus = "applied"
	ProcessedStatusSkipped               ProcessedStatus = "skipped"
	ProcessedStatusSkippedTest           ProcessedStatus = "skipped_test"
	ProcessedStatusSkippedExternal       ProcessedStatus = "skipped_external"
	ProcessedStatusSkippedArchived       ProcessedStatus = "skipped_archived"
	ProcessedStatusSkippedAlreadyApplied ProcessedStatus = "skipped_already_applied"
	ProcessedStatusSkippedCoverLetter    ProcessedStatus = "skipped_cover_letter"
	ProcessedStatusManualAction          ProcessedStatus = "manual_action"
	ProcessedStatusUnknownAfterClick     ProcessedStatus = "unknown_after_click"
	ProcessedStatusError                 ProcessedStatus = "error"
)

func IsTerminalStatus(status string) bool {
	switch ProcessedStatus(status) {
	case ProcessedStatusApplied,
		ProcessedStatusSkipped,
		ProcessedStatusSkippedTest,
		ProcessedStatusSkippedExternal,
		ProcessedStatusSkippedArchived,
		ProcessedStatusSkippedAlreadyApplied,
		ProcessedStatusSkippedCoverLetter,
		ProcessedStatusManualAction,
		ProcessedStatusUnknownAfterClick,
		ProcessedStatusError:
		return true
	default:
		return false
	}
}

type ResultCategoryValue string

const (
	ResultCategoryNone    ResultCategoryValue = "none"
	ResultCategoryApplied ResultCategoryValue = "applied"
	ResultCategorySkipped ResultCategoryValue = "skipped"
	ResultCategoryError   ResultCategoryValue = "error"
)

func ResultCategory(status string) ResultCategoryValue {
	switch ProcessedStatus(status) {
	case ProcessedStatusApplied:
		return ResultCategoryApplied
	case ProcessedStatusSkipped,
		ProcessedStatusSkippedTest,
		ProcessedStatusSkippedExternal,
		ProcessedStatusSkippedArchived,
		ProcessedStatusSkippedAlreadyApplied,
		ProcessedStatusSkippedCoverLetter,
		ProcessedStatusManualAction:
		return ResultCategorySkipped
	case ProcessedStatusUnknownAfterClick, ProcessedStatusError:
		return ResultCategoryError
	default:
		return ResultCategoryNone
	}
}

type CandidateItem struct {
	VacancyID      string `json:"vacancyId"`
	Title          string `json:"title"`
	EmployerName   string `json:"employerName"`
	VacancyURL     string `json:"vacancyUrl"`
	HasTest        bool   `json:"hasTest,omitempty"`
	IsExternal     bool   `json:"isExternal,omitempty"`
	IsArchived     bool   `json:"isArchived,omitempty"`
	RequiresLetter bool   `json:"requiresLetter,omitempty"`
}

type CandidateRejection struct {
	VacancyID string `json:"vacancyId"`
	Reason    string `json:"reason"`
	Status    string `json:"status,omitempty"`
}

type CandidatesResult struct {
	Allow          []string             `json:"allow"`
	Rejected       []CandidateRejection `json:"rejected"`
	RemainingDaily int                  `json:"remainingDaily"`
	RemainingRun   int                  `json:"remainingRun"`
}

type AttemptStart struct {
	RunID        string `json:"runId"`
	VacancyID    string `json:"vacancyId"`
	VacancyTitle string `json:"vacancyTitle"`
	EmployerName string `json:"employerName"`
	VacancyURL   string `json:"vacancyUrl"`
	Notes        string `json:"notes,omitempty"`
}

type AttemptStartResult struct {
	Started bool   `json:"started"`
	Reason  string `json:"reason,omitempty"`
}

type VacancyResult struct {
	RunID          string `json:"runId"`
	VacancyID      string `json:"vacancyId"`
	Status         string `json:"status"`
	VacancyTitle   string `json:"vacancyTitle,omitempty"`
	EmployerName   string `json:"employerName,omitempty"`
	VacancyURL     string `json:"vacancyUrl,omitempty"`
	Notes          string `json:"notes,omitempty"`
	ManualOverride bool   `json:"manualOverride,omitempty"`
}

type VacancyResultOutcome struct {
	Status     string `json:"status"`
	Counted    bool   `json:"counted"`
	Idempotent bool   `json:"idempotent"`
}

type ProcessedVacancy struct {
	VacancyID    string    `json:"vacancyId"`
	RunID        string    `json:"runId,omitempty"`
	Status       string    `json:"status"`
	VacancyTitle string    `json:"vacancyTitle,omitempty"`
	EmployerName string    `json:"employerName,omitempty"`
	VacancyURL   string    `json:"vacancyUrl,omitempty"`
	Notes        string    `json:"notes,omitempty"`
	AppliedAt    time.Time `json:"appliedAt,omitempty"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type TodayStats struct {
	Applied         int                `json:"applied"`
	Skipped         int                `json:"skipped"`
	Errors          int                `json:"errors"`
	RemainingDaily  int                `json:"remainingDaily"`
	ActiveRun       *Run               `json:"activeRun"`
	RecentVacancies []ProcessedVacancy `json:"recentVacancies"`
}

type EventKind string

const (
	EventKindCaptcha   EventKind = "captcha"
	EventKindLoginLost EventKind = "login_lost"
	EventKindError     EventKind = "error"
)

type Event struct {
	Kind        EventKind      `json:"kind"`
	RunID       string         `json:"runId,omitempty"`
	VacancyID   string         `json:"vacancyId,omitempty"`
	VacancyURL  string         `json:"vacancyUrl,omitempty"`
	Message     string         `json:"message,omitempty"`
	NonBlocking bool           `json:"nonBlocking,omitempty"`
	Details     map[string]any `json:"details,omitempty"`
}

type CoverLetterLanguage string

const (
	CoverLetterLanguageRU CoverLetterLanguage = "ru"
	CoverLetterLanguageEN CoverLetterLanguage = "en"
)

type CoverLetterStatus string

const (
	CoverLetterStatusPendingApproval CoverLetterStatus = "pending_approval"
	CoverLetterStatusApproved        CoverLetterStatus = "approved"
	CoverLetterStatusSkipped         CoverLetterStatus = "skipped"
	CoverLetterStatusExpired         CoverLetterStatus = "expired"
)

type CoverLetter struct {
	ID             string              `json:"id"`
	VacancyID      string              `json:"vacancyId"`
	VacancyTitle   string              `json:"vacancyTitle,omitempty"`
	VacancyURL     string              `json:"vacancyUrl,omitempty"`
	Body           string              `json:"body,omitempty"`
	Language       CoverLetterLanguage `json:"language"`
	Status         CoverLetterStatus   `json:"status"`
	ExpiresAt      time.Time           `json:"expiresAt"`
	CreatedAt      time.Time           `json:"createdAt,omitempty"`
	ApprovalQueued bool                `json:"approvalQueued,omitempty"`
}

type CoverLetterRequest struct {
	RunID              string `json:"runId,omitempty"`
	VacancyID          string `json:"vacancyId,omitempty"`
	VacancyTitle       string `json:"vacancyTitle,omitempty"`
	VacancyDescription string `json:"vacancyDescription,omitempty"`
	VacancyURL         string `json:"vacancyUrl,omitempty"`
}

type CoverLetterCreate struct {
	VacancyID    string
	VacancyTitle string
	VacancyURL   string
	Body         string
	Language     CoverLetterLanguage
	Status       CoverLetterStatus
	ExpiresAt    time.Time
}

type CoverLetterApprovalNotification struct {
	VacancyID    string              `json:"vacancyId"`
	VacancyTitle string              `json:"vacancyTitle,omitempty"`
	VacancyURL   string              `json:"vacancyUrl,omitempty"`
	Body         string              `json:"body"`
	Language     CoverLetterLanguage `json:"language"`
	ExpiresAt    time.Time           `json:"expiresAt"`
}

type CoverLetterCallbackAction string

const (
	CoverLetterCallbackApprove CoverLetterCallbackAction = "approve"
	CoverLetterCallbackEdit    CoverLetterCallbackAction = "edit"
	CoverLetterCallbackSkip    CoverLetterCallbackAction = "skip"
)

type CoverLetterCallback struct {
	VacancyID string                    `json:"vacancyId"`
	Action    CoverLetterCallbackAction `json:"action"`
}

type CoverLetterCallbackResult struct {
	Changed bool        `json:"changed"`
	Letter  CoverLetter `json:"letter"`
}
