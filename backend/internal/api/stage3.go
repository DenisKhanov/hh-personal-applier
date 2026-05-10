package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"hh-personal-applier/internal/storage"
)

type emptyInput struct{}

type settingsInput struct {
	Body storage.Settings
}

type settingsOutput struct {
	Body storage.Settings
}

type startRunInput struct {
	Body struct {
		SearchURL string `json:"searchUrl"`
	}
}

type runIDInput struct {
	Body struct {
		RunID string `json:"runId"`
	}
}

type stopRunInput struct {
	Body struct {
		RunID  string `json:"runId"`
		Reason string `json:"reason"`
	}
}

type runOutput struct {
	Body storage.Run
}

type candidatesInput struct {
	Body struct {
		RunID string                  `json:"runId"`
		Items []storage.CandidateItem `json:"items"`
	}
}

type candidatesOutput struct {
	Body storage.CandidatesResult
}

type attemptInput struct {
	Body storage.AttemptStart
}

type attemptOutput struct {
	Body storage.AttemptStartResult
}

type vacancyResultInput struct {
	Body storage.VacancyResult
}

type vacancyResultOutput struct {
	Body storage.VacancyResultOutcome
}

type statsOutput struct {
	Body storage.TodayStats
}

type eventInput struct {
	Body struct {
		RunID     string         `json:"runId,omitempty"`
		VacancyID string         `json:"vacancyId,omitempty"`
		Message   string         `json:"message,omitempty"`
		Details   map[string]any `json:"details,omitempty"`
	}
}

type eventOutput struct {
	Body struct {
		Recorded bool `json:"recorded"`
	}
}

func registerStage3(api huma.API, store storage.Store) {
	huma.Register(api, huma.Operation{
		OperationID: "get-settings",
		Method:      http.MethodGet,
		Path:        "/settings",
		Summary:     "Get owner settings",
		Tags:        []string{"settings"},
	}, func(ctx context.Context, _ *emptyInput) (*settingsOutput, error) {
		settings, err := store.GetSettings(ctx)
		if err != nil {
			return nil, apiError(err)
		}
		return &settingsOutput{Body: settings}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "put-settings",
		Method:      http.MethodPut,
		Path:        "/settings",
		Summary:     "Update owner settings",
		Tags:        []string{"settings"},
	}, func(ctx context.Context, input *settingsInput) (*settingsOutput, error) {
		if err := storage.ValidateSettings(input.Body); err != nil {
			return nil, apiError(err)
		}
		settings, err := store.UpdateSettings(ctx, input.Body)
		if err != nil {
			return nil, apiError(err)
		}
		return &settingsOutput{Body: settings}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "start-run",
		Method:      http.MethodPost,
		Path:        "/runs/start",
		Summary:     "Start apply run",
		Tags:        []string{"runs"},
	}, func(ctx context.Context, input *startRunInput) (*runOutput, error) {
		searchURL := strings.TrimSpace(input.Body.SearchURL)
		if searchURL == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_search_url", "searchUrl is required")
		}
		run, err := store.StartRun(ctx, searchURL)
		if err != nil {
			return nil, apiError(err)
		}
		return &runOutput{Body: run}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "stop-run",
		Method:      http.MethodPost,
		Path:        "/runs/stop",
		Summary:     "Stop apply run",
		Tags:        []string{"runs"},
	}, func(ctx context.Context, input *stopRunInput) (*runOutput, error) {
		runID := strings.TrimSpace(input.Body.RunID)
		if runID == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_run_id", "runId is required")
		}
		reason := strings.TrimSpace(input.Body.Reason)
		if reason == "" {
			reason = "owner_stop"
		}
		if err := storage.ValidateStopReason(reason); err != nil {
			return nil, apiError(err)
		}
		run, err := store.StopRun(ctx, runID, reason)
		if err != nil {
			return nil, apiError(err)
		}
		return &runOutput{Body: run}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "continue-run",
		Method:      http.MethodPost,
		Path:        "/runs/continue",
		Summary:     "Continue paused apply run",
		Tags:        []string{"runs"},
	}, func(ctx context.Context, input *runIDInput) (*runOutput, error) {
		runID := strings.TrimSpace(input.Body.RunID)
		if runID == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_run_id", "runId is required")
		}
		run, err := store.ContinueRun(ctx, runID)
		if err != nil {
			return nil, apiError(err)
		}
		return &runOutput{Body: run}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "filter-candidates",
		Method:      http.MethodPost,
		Path:        "/candidates",
		Summary:     "Filter vacancy candidates",
		Tags:        []string{"vacancies"},
	}, func(ctx context.Context, input *candidatesInput) (*candidatesOutput, error) {
		runID := strings.TrimSpace(input.Body.RunID)
		if runID == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_run_id", "runId is required")
		}
		result, err := store.FilterCandidates(ctx, runID, input.Body.Items)
		if err != nil {
			return nil, apiError(err)
		}
		return &candidatesOutput{Body: result}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "start-attempt",
		Method:      http.MethodPost,
		Path:        "/attempts/start",
		Summary:     "Record an apply attempt before click",
		Tags:        []string{"vacancies"},
	}, func(ctx context.Context, input *attemptInput) (*attemptOutput, error) {
		if strings.TrimSpace(input.Body.RunID) == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_run_id", "runId is required")
		}
		if strings.TrimSpace(input.Body.VacancyID) == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_vacancy_id", "vacancyId is required")
		}
		result, err := store.StartAttempt(ctx, input.Body)
		if err != nil {
			return nil, apiError(err)
		}
		return &attemptOutput{Body: result}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "record-vacancy-result",
		Method:      http.MethodPost,
		Path:        "/vacancies/result",
		Summary:     "Finalize vacancy result",
		Tags:        []string{"vacancies"},
	}, func(ctx context.Context, input *vacancyResultInput) (*vacancyResultOutput, error) {
		if strings.TrimSpace(input.Body.RunID) == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_run_id", "runId is required")
		}
		if strings.TrimSpace(input.Body.VacancyID) == "" {
			return nil, newStatusError(http.StatusBadRequest, "invalid_vacancy_id", "vacancyId is required")
		}
		if !storage.IsTerminalStatus(input.Body.Status) {
			return nil, newStatusError(http.StatusBadRequest, "invalid_result_status", "status must be a terminal processed_vacancies status")
		}
		result, err := store.FinalizeVacancyResult(ctx, input.Body)
		if err != nil {
			return nil, apiError(err)
		}
		return &vacancyResultOutput{Body: result}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-today-stats",
		Method:      http.MethodGet,
		Path:        "/stats/today",
		Summary:     "Get today's apply stats",
		Tags:        []string{"stats"},
	}, func(ctx context.Context, _ *emptyInput) (*statsOutput, error) {
		stats, err := store.GetTodayStats(ctx)
		if err != nil {
			return nil, apiError(err)
		}
		return &statsOutput{Body: stats}, nil
	})

	registerEvent(api, store, storage.EventKindCaptcha, "/events/captcha", "record-captcha-event")
	registerEvent(api, store, storage.EventKindLoginLost, "/events/login_lost", "record-login-lost-event")
	registerEvent(api, store, storage.EventKindError, "/events/error", "record-error-event")
}

func registerEvent(api huma.API, store storage.Store, kind storage.EventKind, path string, operationID string) {
	huma.Register(api, huma.Operation{
		OperationID: operationID,
		Method:      http.MethodPost,
		Path:        path,
		Summary:     "Record safety event",
		Tags:        []string{"events"},
	}, func(ctx context.Context, input *eventInput) (*eventOutput, error) {
		event := storage.Event{
			Kind:      kind,
			RunID:     input.Body.RunID,
			VacancyID: input.Body.VacancyID,
			Message:   input.Body.Message,
			Details:   input.Body.Details,
		}
		if err := store.RecordEvent(ctx, event); err != nil {
			return nil, apiError(err)
		}
		out := &eventOutput{}
		out.Body.Recorded = true
		return out, nil
	})
}
