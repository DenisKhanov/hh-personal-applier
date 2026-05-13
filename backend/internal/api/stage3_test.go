package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"hh-personal-applier/internal/api"
	"hh-personal-applier/internal/storage"
)

func TestSettingsHandlersReadAndValidateUpdates(t *testing.T) {
	store := newFakeStore()
	mux := api.NewRouter(testSecret, store)

	getResponse := doJSON(t, mux, http.MethodGet, "/settings", nil)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("expected GET /settings 200, got %d: %s", getResponse.Code, getResponse.Body.String())
	}
	var settings storage.Settings
	decodeJSON(t, getResponse, &settings)
	if settings.DailyLimit != 100 || settings.RunLimit != 25 {
		t.Fatalf("unexpected settings: %+v", settings)
	}

	invalid := storage.Settings{
		DailyLimit:                 100,
		RunLimit:                   25,
		PaceMinSeconds:             20,
		PaceMaxSeconds:             10,
		SkipWithTest:               true,
		SkipExternal:               true,
		RequireCoverLetterApproval: true,
		AutoApply:                  false,
	}
	putResponse := doJSON(t, mux, http.MethodPut, "/settings", invalid)
	if putResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid PUT /settings 400, got %d: %s", putResponse.Code, putResponse.Body.String())
	}
	if store.updateSettingsCalls != 0 {
		t.Fatalf("expected invalid settings to be rejected before storage, got %d storage calls", store.updateSettingsCalls)
	}
	assertErrorCode(t, putResponse, "invalid_settings")
}

func TestRunLifecycleHandlers(t *testing.T) {
	store := newFakeStore()
	mux := api.NewRouter(testSecret, store)

	startResponse := doJSON(t, mux, http.MethodPost, "/runs/start", map[string]string{
		"searchUrl": "https://hh.ru/search/vacancy?text=go",
	})
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected POST /runs/start 200, got %d: %s", startResponse.Code, startResponse.Body.String())
	}
	var started storage.Run
	decodeJSON(t, startResponse, &started)
	if started.ID == "" || started.SettingsSnapshot.DailyLimit != 100 {
		t.Fatalf("expected run id and settings snapshot, got %+v", started)
	}

	conflictResponse := doJSON(t, mux, http.MethodPost, "/runs/start", map[string]string{
		"searchUrl": "https://hh.ru/search/vacancy?text=go",
	})
	if conflictResponse.Code != http.StatusConflict {
		t.Fatalf("expected second start 409, got %d: %s", conflictResponse.Code, conflictResponse.Body.String())
	}
	assertErrorCode(t, conflictResponse, "active_run_exists")

	continueResponse := doJSON(t, mux, http.MethodPost, "/runs/continue", map[string]string{
		"runId": started.ID,
	})
	if continueResponse.Code != http.StatusConflict {
		t.Fatalf("expected continue on running run 409, got %d: %s", continueResponse.Code, continueResponse.Body.String())
	}
	assertErrorCode(t, continueResponse, "run_not_paused")

	stopResponse := doJSON(t, mux, http.MethodPost, "/runs/stop", map[string]string{
		"runId":  started.ID,
		"reason": "owner_stop",
	})
	if stopResponse.Code != http.StatusOK {
		t.Fatalf("expected stop 200, got %d: %s", stopResponse.Code, stopResponse.Body.String())
	}
}

func TestStopRunRejectsUnknownReason(t *testing.T) {
	store := newFakeStore()
	store.activeRun = &storage.Run{
		ID:               "run-1",
		Status:           storage.RunStatusRunning,
		SettingsSnapshot: store.settings,
	}
	mux := api.NewRouter(testSecret, store)

	response := doJSON(t, mux, http.MethodPost, "/runs/stop", map[string]string{
		"runId":  "run-1",
		"reason": "surprise_reason",
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid stop reason 400, got %d: %s", response.Code, response.Body.String())
	}
	assertErrorCode(t, response, "invalid_stop_reason")
}

func TestCandidatesHandlerReturnsAllowListAndReasons(t *testing.T) {
	store := newFakeStore()
	store.activeRun = &storage.Run{
		ID:               "run-1",
		Status:           storage.RunStatusRunning,
		SettingsSnapshot: store.settings,
	}
	store.processed["2"] = storage.ProcessedStatusApplied
	mux := api.NewRouter(testSecret, store)

	response := doJSON(t, mux, http.MethodPost, "/candidates", map[string]any{
		"runId": "run-1",
		"items": []map[string]any{
			{"vacancyId": "1", "title": "Go developer", "employerName": "Acme", "vacancyUrl": "https://hh.ru/vacancy/1"},
			{"vacancyId": "2", "title": "Done", "employerName": "Acme", "vacancyUrl": "https://hh.ru/vacancy/2"},
			{"vacancyId": "3", "title": "Test", "employerName": "Acme", "vacancyUrl": "https://hh.ru/vacancy/3", "hasTest": true},
		},
	})
	if response.Code != http.StatusOK {
		t.Fatalf("expected candidates 200, got %d: %s", response.Code, response.Body.String())
	}

	var body storage.CandidatesResult
	decodeJSON(t, response, &body)
	if len(body.Allow) != 1 || body.Allow[0] != "1" {
		t.Fatalf("expected only vacancy 1 allowed, got %+v", body)
	}
	if len(body.Rejected) != 2 {
		t.Fatalf("expected two rejected candidates, got %+v", body)
	}
	if body.Rejected[0].Reason != "already_processed" || body.Rejected[1].Reason != "has_test" {
		t.Fatalf("unexpected reject reasons: %+v", body.Rejected)
	}
}

func TestCandidatesHandlerRejectsNonRunningRun(t *testing.T) {
	store := newFakeStore()
	store.activeRun = &storage.Run{
		ID:               "run-1",
		Status:           storage.RunStatusPausedUnknown,
		SettingsSnapshot: store.settings,
	}
	mux := api.NewRouter(testSecret, store)

	response := doJSON(t, mux, http.MethodPost, "/candidates", map[string]any{
		"runId": "run-1",
		"items": []map[string]any{
			{"vacancyId": "1", "title": "Go developer", "employerName": "Acme", "vacancyUrl": "https://hh.ru/vacancy/1"},
		},
	})
	if response.Code != http.StatusConflict {
		t.Fatalf("expected candidates on paused run 409, got %d: %s", response.Code, response.Body.String())
	}
	assertErrorCode(t, response, "run_not_running")
}

func TestCandidatesHandlerAllowsAttemptingVacancies(t *testing.T) {
	store := newFakeStore()
	store.activeRun = &storage.Run{
		ID:               "run-2",
		Status:           storage.RunStatusRunning,
		SettingsSnapshot: store.settings,
	}
	store.processed["1"] = storage.ProcessedStatusAttempting
	store.processed["2"] = storage.ProcessedStatusApplied
	mux := api.NewRouter(testSecret, store)

	response := doJSON(t, mux, http.MethodPost, "/candidates", map[string]any{
		"runId": "run-2",
		"items": []map[string]any{
			{"vacancyId": "1", "title": "Stuck attempting", "employerName": "Acme", "vacancyUrl": "https://hh.ru/vacancy/1"},
			{"vacancyId": "2", "title": "Already applied", "employerName": "Acme", "vacancyUrl": "https://hh.ru/vacancy/2"},
			{"vacancyId": "3", "title": "New vacancy", "employerName": "Acme", "vacancyUrl": "https://hh.ru/vacancy/3"},
		},
	})
	if response.Code != http.StatusOK {
		t.Fatalf("expected candidates 200, got %d: %s", response.Code, response.Body.String())
	}

	var body storage.CandidatesResult
	decodeJSON(t, response, &body)
	if len(body.Allow) != 2 {
		t.Fatalf("expected vacancy 1 (attempting) and 3 (new) allowed, got allow=%v", body.Allow)
	}
	allowed := map[string]bool{}
	for _, id := range body.Allow {
		allowed[id] = true
	}
	if !allowed["1"] || !allowed["3"] {
		t.Fatalf("expected vacancies 1 and 3 in allow list, got %v", body.Allow)
	}
	if len(body.Rejected) != 1 || body.Rejected[0].VacancyID != "2" || body.Rejected[0].Reason != "already_processed" {
		t.Fatalf("expected only vacancy 2 rejected as already_processed, got %+v", body.Rejected)
	}
}

func TestAttemptsStartAndVacanciesResultAreIdempotent(t *testing.T) {
	store := newFakeStore()
	store.activeRun = &storage.Run{
		ID:               "run-1",
		Status:           storage.RunStatusRunning,
		SettingsSnapshot: store.settings,
	}
	mux := api.NewRouter(testSecret, store)

	attemptResponse := doJSON(t, mux, http.MethodPost, "/attempts/start", map[string]any{
		"runId":        "run-1",
		"vacancyId":    "42",
		"vacancyTitle": "Go developer",
		"employerName": "Acme",
		"vacancyUrl":   "https://hh.ru/vacancy/42",
	})
	if attemptResponse.Code != http.StatusOK {
		t.Fatalf("expected attempt start 200, got %d: %s", attemptResponse.Code, attemptResponse.Body.String())
	}

	firstResult := doJSON(t, mux, http.MethodPost, "/vacancies/result", map[string]any{
		"runId":        "run-1",
		"vacancyId":    "42",
		"status":       "applied",
		"vacancyTitle": "Go developer",
		"employerName": "Acme",
		"vacancyUrl":   "https://hh.ru/vacancy/42",
	})
	if firstResult.Code != http.StatusOK {
		t.Fatalf("expected first result 200, got %d: %s", firstResult.Code, firstResult.Body.String())
	}
	var counted storage.VacancyResultOutcome
	decodeJSON(t, firstResult, &counted)
	if !counted.Counted || counted.Idempotent {
		t.Fatalf("expected first result to count once, got %+v", counted)
	}

	secondResult := doJSON(t, mux, http.MethodPost, "/vacancies/result", map[string]any{
		"runId":     "run-1",
		"vacancyId": "42",
		"status":    "applied",
	})
	if secondResult.Code != http.StatusOK {
		t.Fatalf("expected duplicate result 200, got %d: %s", secondResult.Code, secondResult.Body.String())
	}
	var duplicate storage.VacancyResultOutcome
	decodeJSON(t, secondResult, &duplicate)
	if duplicate.Counted || !duplicate.Idempotent {
		t.Fatalf("expected duplicate result to be idempotent, got %+v", duplicate)
	}
	if store.activeRun.AppliedCount != 1 {
		t.Fatalf("expected applied counter to increment once, got %d", store.activeRun.AppliedCount)
	}
}

func TestStartAttemptReturnsAlreadyAttemptingForSameRun(t *testing.T) {
	store := newFakeStore()
	store.activeRun = &storage.Run{
		ID:               "run-1",
		Status:           storage.RunStatusRunning,
		SettingsSnapshot: store.settings,
	}
	mux := api.NewRouter(testSecret, store)
	request := map[string]any{
		"runId":        "run-1",
		"vacancyId":    "42",
		"vacancyTitle": "Go developer",
		"employerName": "Acme",
		"vacancyUrl":   "https://hh.ru/vacancy/42",
	}

	firstResponse := doJSON(t, mux, http.MethodPost, "/attempts/start", request)
	if firstResponse.Code != http.StatusOK {
		t.Fatalf("expected first attempt 200, got %d: %s", firstResponse.Code, firstResponse.Body.String())
	}

	secondResponse := doJSON(t, mux, http.MethodPost, "/attempts/start", request)
	if secondResponse.Code != http.StatusOK {
		t.Fatalf("expected duplicate attempting attempt 200, got %d: %s", secondResponse.Code, secondResponse.Body.String())
	}
	var body storage.AttemptStartResult
	decodeJSON(t, secondResponse, &body)
	if body.Started || body.Reason != "already_attempting" {
		t.Fatalf("expected already_attempting no-op, got %+v", body)
	}
}

func TestVacancyResultRequiresManualOverrideForUnknownAfterClick(t *testing.T) {
	store := newFakeStore()
	store.activeRun = &storage.Run{
		ID:               "run-1",
		Status:           storage.RunStatusRunning,
		SettingsSnapshot: store.settings,
		ErrorCount:       1,
	}
	store.processed["42"] = storage.ProcessedStatusUnknownAfterClick
	mux := api.NewRouter(testSecret, store)

	withoutOverride := doJSON(t, mux, http.MethodPost, "/vacancies/result", map[string]any{
		"runId":     "run-1",
		"vacancyId": "42",
		"status":    "applied",
	})
	if withoutOverride.Code != http.StatusConflict {
		t.Fatalf("expected unknown_after_click without manualOverride 409, got %d: %s", withoutOverride.Code, withoutOverride.Body.String())
	}
	assertErrorCode(t, withoutOverride, "vacancy_already_finalized")

	withOverride := doJSON(t, mux, http.MethodPost, "/vacancies/result", map[string]any{
		"runId":          "run-1",
		"vacancyId":      "42",
		"status":         "applied",
		"manualOverride": true,
	})
	if withOverride.Code != http.StatusOK {
		t.Fatalf("expected unknown_after_click manualOverride 200, got %d: %s", withOverride.Code, withOverride.Body.String())
	}
	if store.activeRun.AppliedCount != 1 || store.activeRun.ErrorCount != 0 {
		t.Fatalf("expected manual override to move counter from error to applied, got run %+v", store.activeRun)
	}
}

func TestVacancyResultMixedStatusesUpdateStatsCategories(t *testing.T) {
	store := newFakeStore()
	store.activeRun = &storage.Run{
		ID:               "run-1",
		Status:           storage.RunStatusRunning,
		SettingsSnapshot: store.settings,
	}
	mux := api.NewRouter(testSecret, store)

	statuses := []string{
		"applied",
		"applied",
		"skipped_cover_letter",
		"manual_action",
		"unknown_after_click",
		"error",
	}
	for index, status := range statuses {
		response := doJSON(t, mux, http.MethodPost, "/vacancies/result", map[string]any{
			"runId":     "run-1",
			"vacancyId": fmt.Sprintf("vacancy-%d", index+1),
			"status":    status,
		})
		if response.Code != http.StatusOK {
			t.Fatalf("expected %s result 200, got %d: %s", status, response.Code, response.Body.String())
		}
	}

	statsResponse := doJSON(t, mux, http.MethodGet, "/stats/today", nil)
	if statsResponse.Code != http.StatusOK {
		t.Fatalf("expected stats 200, got %d: %s", statsResponse.Code, statsResponse.Body.String())
	}
	var stats storage.TodayStats
	decodeJSON(t, statsResponse, &stats)
	if stats.Applied != 2 || stats.Skipped != 2 || stats.Errors != 2 {
		t.Fatalf("expected mixed stats applied=2 skipped=2 errors=2, got %+v", stats)
	}
}

func TestStatsAndEventsHandlers(t *testing.T) {
	store := newFakeStore()
	store.activeRun = &storage.Run{
		ID:               "run-1",
		Status:           storage.RunStatusRunning,
		SettingsSnapshot: store.settings,
		AppliedCount:     2,
	}
	mux := api.NewRouter(testSecret, store)

	statsResponse := doJSON(t, mux, http.MethodGet, "/stats/today", nil)
	if statsResponse.Code != http.StatusOK {
		t.Fatalf("expected stats 200, got %d: %s", statsResponse.Code, statsResponse.Body.String())
	}
	var stats storage.TodayStats
	decodeJSON(t, statsResponse, &stats)
	if stats.RemainingDaily != 98 || stats.ActiveRun == nil || stats.ActiveRun.ID != "run-1" {
		t.Fatalf("unexpected stats: %+v", stats)
	}

	eventResponse := doJSON(t, mux, http.MethodPost, "/events/captcha", map[string]any{
		"runId":   "run-1",
		"message": "captcha visible",
	})
	if eventResponse.Code != http.StatusOK {
		t.Fatalf("expected event 200, got %d: %s", eventResponse.Code, eventResponse.Body.String())
	}
	if len(store.events) != 1 || store.events[0].Kind != storage.EventKindCaptcha {
		t.Fatalf("expected captcha event, got %+v", store.events)
	}
}

func TestNonBlockingErrorEventCarriesVacancyURLAndDoesNotPauseRun(t *testing.T) {
	store := newFakeStore()
	store.activeRun = &storage.Run{
		ID:               "run-1",
		Status:           storage.RunStatusRunning,
		SettingsSnapshot: store.settings,
	}
	mux := api.NewRouter(testSecret, store)

	response := doJSON(t, mux, http.MethodPost, "/events/error", map[string]any{
		"runId":       "run-1",
		"vacancyId":   "42",
		"vacancyUrl":  "https://hh.ru/vacancy/42",
		"message":     "Unknown state after click",
		"nonBlocking": true,
		"details": map[string]any{
			"status": "unknown_after_click",
		},
	})
	if response.Code != http.StatusOK {
		t.Fatalf("expected non-blocking error event 200, got %d: %s", response.Code, response.Body.String())
	}
	if store.activeRun.Status != storage.RunStatusRunning {
		t.Fatalf("expected run to stay running, got %s", store.activeRun.Status)
	}
	if len(store.events) != 1 {
		t.Fatalf("expected one event, got %+v", store.events)
	}
	event := store.events[0]
	if !event.NonBlocking || event.VacancyURL != "https://hh.ru/vacancy/42" {
		t.Fatalf("expected non-blocking event with URL, got %+v", event)
	}
}

func TestTelegramTestHandlerQueuesGreeting(t *testing.T) {
	store := newFakeStore()
	mux := api.NewRouter(testSecret, store)

	response := doJSON(t, mux, http.MethodPost, "/telegram/test", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("expected telegram test 200, got %d: %s", response.Code, response.Body.String())
	}

	var body storage.NotificationQueueResult
	decodeJSON(t, response, &body)
	if !body.Queued {
		t.Fatalf("expected queued=true, got %+v", body)
	}
	if store.telegramTestCalls != 1 {
		t.Fatalf("expected one telegram test queue call, got %d", store.telegramTestCalls)
	}
}

type fakeStore struct {
	settings            storage.Settings
	updateSettingsCalls int
	activeRun           *storage.Run
	processed           map[string]storage.ProcessedStatus
	processedRun        map[string]string
	events              []storage.Event
	telegramTestCalls   int
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
		processed:    make(map[string]storage.ProcessedStatus),
		processedRun: make(map[string]string),
	}
}

func (f *fakeStore) GetSettings(_ context.Context) (storage.Settings, error) {
	return f.settings, nil
}

func (f *fakeStore) UpdateSettings(_ context.Context, settings storage.Settings) (storage.Settings, error) {
	f.updateSettingsCalls++
	f.settings = settings
	return settings, nil
}

func (f *fakeStore) StartRun(_ context.Context, searchURL string) (storage.Run, error) {
	if f.activeRun != nil && f.activeRun.IsActive() {
		return storage.Run{}, storage.NewConflict("active_run_exists", "an active run already exists")
	}
	f.activeRun = &storage.Run{
		ID:               "run-1",
		Status:           storage.RunStatusRunning,
		SearchURL:        searchURL,
		SettingsSnapshot: f.settings,
	}
	return *f.activeRun, nil
}

func (f *fakeStore) StopRun(_ context.Context, runID string, reason string) (storage.Run, error) {
	if f.activeRun == nil || f.activeRun.ID != runID {
		return storage.Run{}, storage.NewNotFound("run_not_found", "run not found")
	}
	if err := storage.ValidateStopReason(reason); err != nil {
		return storage.Run{}, err
	}
	f.activeRun.Status = storage.StopStatusForReason(reason)
	f.activeRun.StopReason = reason
	return *f.activeRun, nil
}

func (f *fakeStore) ContinueRun(_ context.Context, runID string) (storage.Run, error) {
	if f.activeRun == nil || f.activeRun.ID != runID {
		return storage.Run{}, storage.NewNotFound("run_not_found", "run not found")
	}
	if !f.activeRun.IsPaused() {
		return storage.Run{}, storage.NewConflict("run_not_paused", "run is not paused")
	}
	f.activeRun.Status = storage.RunStatusRunning
	return *f.activeRun, nil
}

func (f *fakeStore) FilterCandidates(_ context.Context, runID string, items []storage.CandidateItem) (storage.CandidatesResult, error) {
	if f.activeRun == nil || f.activeRun.ID != runID {
		return storage.CandidatesResult{}, storage.NewNotFound("run_not_found", "run not found")
	}
	if f.activeRun.Status != storage.RunStatusRunning {
		return storage.CandidatesResult{}, storage.NewConflict("run_not_running", "run is not running")
	}
	result := storage.CandidatesResult{RemainingDaily: 100, RemainingRun: 25}
	for _, item := range items {
		if status, ok := f.processed[item.VacancyID]; ok {
			if status == storage.ProcessedStatusAttempting {
				// Vacancies stuck in "attempting" should be retried.
			} else {
				result.Rejected = append(result.Rejected, storage.CandidateRejection{
					VacancyID: item.VacancyID,
					Reason:    "already_processed",
					Status:    string(status),
				})
				continue
			}
		}
		if item.HasTest && f.settings.SkipWithTest {
			result.Rejected = append(result.Rejected, storage.CandidateRejection{
				VacancyID: item.VacancyID,
				Reason:    "has_test",
			})
			continue
		}
		result.Allow = append(result.Allow, item.VacancyID)
	}
	return result, nil
}

func (f *fakeStore) StartAttempt(_ context.Context, attempt storage.AttemptStart) (storage.AttemptStartResult, error) {
	if f.activeRun == nil || f.activeRun.ID != attempt.RunID {
		return storage.AttemptStartResult{}, storage.NewNotFound("run_not_found", "run not found")
	}
	if f.activeRun.Status != storage.RunStatusRunning {
		return storage.AttemptStartResult{}, storage.NewConflict("run_not_running", "run is not running")
	}
	if status, exists := f.processed[attempt.VacancyID]; exists {
		if status == storage.ProcessedStatusAttempting && f.processedRun[attempt.VacancyID] == attempt.RunID {
			return storage.AttemptStartResult{Started: false, Reason: "already_attempting"}, nil
		}
		if status == storage.ProcessedStatusAttempting {
			// Allow retry for vacancies stuck in "attempting" from a different run.
			f.processedRun[attempt.VacancyID] = attempt.RunID
			return storage.AttemptStartResult{Started: true}, nil
		}
		return storage.AttemptStartResult{}, storage.NewConflict("vacancy_already_processed", "vacancy already processed")
	}
	f.processed[attempt.VacancyID] = storage.ProcessedStatusAttempting
	f.processedRun[attempt.VacancyID] = attempt.RunID
	return storage.AttemptStartResult{Started: true}, nil
}

func (f *fakeStore) FinalizeVacancyResult(_ context.Context, result storage.VacancyResult) (storage.VacancyResultOutcome, error) {
	if f.activeRun == nil || f.activeRun.ID != result.RunID {
		return storage.VacancyResultOutcome{}, storage.NewNotFound("run_not_found", "run not found")
	}
	oldStatus, exists := f.processed[result.VacancyID]
	if exists && oldStatus == storage.ProcessedStatus(result.Status) {
		return storage.VacancyResultOutcome{Status: result.Status, Idempotent: true}, nil
	}
	if exists && storage.IsTerminalStatus(string(oldStatus)) {
		canManualOverride := result.ManualOverride &&
			oldStatus == storage.ProcessedStatusUnknownAfterClick &&
			(result.Status == string(storage.ProcessedStatusApplied) || result.Status == string(storage.ProcessedStatusSkipped))
		if !canManualOverride {
			return storage.VacancyResultOutcome{}, storage.NewConflict("vacancy_already_finalized", "vacancy already has a terminal status")
		}
	}
	f.processed[result.VacancyID] = storage.ProcessedStatus(result.Status)
	f.processedRun[result.VacancyID] = result.RunID

	oldCategory := storage.ResultCategoryNone
	if exists {
		oldCategory = storage.ResultCategory(string(oldStatus))
	}
	newCategory := storage.ResultCategory(result.Status)
	applyFakeCounterDelta(f.activeRun, oldCategory, newCategory)

	return storage.VacancyResultOutcome{Status: result.Status, Counted: oldCategory != newCategory}, nil
}

func applyFakeCounterDelta(run *storage.Run, oldCategory storage.ResultCategoryValue, newCategory storage.ResultCategoryValue) {
	if oldCategory == newCategory {
		return
	}
	if oldCategory == storage.ResultCategoryApplied {
		run.AppliedCount--
	}
	if oldCategory == storage.ResultCategorySkipped {
		run.SkippedCount--
	}
	if oldCategory == storage.ResultCategoryError {
		run.ErrorCount--
	}
	if newCategory == storage.ResultCategoryApplied {
		run.AppliedCount++
	}
	if newCategory == storage.ResultCategorySkipped {
		run.SkippedCount++
	}
	if newCategory == storage.ResultCategoryError {
		run.ErrorCount++
	}
}

func (f *fakeStore) GetTodayStats(_ context.Context) (storage.TodayStats, error) {
	return storage.TodayStats{
		Applied:        f.activeRun.AppliedCount,
		Skipped:        f.activeRun.SkippedCount,
		Errors:         f.activeRun.ErrorCount,
		RemainingDaily: f.settings.DailyLimit - f.activeRun.AppliedCount,
		ActiveRun:      f.activeRun,
	}, nil
}

func (f *fakeStore) RecordEvent(_ context.Context, event storage.Event) error {
	f.events = append(f.events, event)
	return nil
}

func (f *fakeStore) QueueTelegramTest(_ context.Context) (storage.NotificationQueueResult, error) {
	f.telegramTestCalls++
	return storage.NotificationQueueResult{Queued: true}, nil
}

func doJSON(t *testing.T, mux http.Handler, method string, path string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var requestBody *bytes.Reader
	if body == nil {
		requestBody = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		requestBody = bytes.NewReader(raw)
	}

	req := httptest.NewRequest(method, path, requestBody)
	req.Header.Set("X-Local-Secret", testSecret)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

func decodeJSON(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()

	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatalf("decode response: %v; body: %s", err, response.Body.String())
	}
}

func assertErrorCode(t *testing.T, response *httptest.ResponseRecorder, expected string) {
	t.Helper()

	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeJSON(t, response, &body)
	if body.Error.Code != expected {
		t.Fatalf("expected error code %q, got %q", expected, body.Error.Code)
	}
}
