package storage

import "testing"

func TestResultCategoryForMixedDailyReportStatuses(t *testing.T) {
	tests := map[string]ResultCategoryValue{
		string(ProcessedStatusApplied):               ResultCategoryApplied,
		string(ProcessedStatusSkipped):               ResultCategorySkipped,
		string(ProcessedStatusSkippedTest):           ResultCategorySkipped,
		string(ProcessedStatusSkippedExternal):       ResultCategorySkipped,
		string(ProcessedStatusSkippedArchived):       ResultCategorySkipped,
		string(ProcessedStatusSkippedAlreadyApplied): ResultCategorySkipped,
		string(ProcessedStatusSkippedCoverLetter):    ResultCategorySkipped,
		string(ProcessedStatusManualAction):          ResultCategorySkipped,
		string(ProcessedStatusUnknownAfterClick):     ResultCategoryError,
		string(ProcessedStatusAttempting):            ResultCategoryNone,
		string(CoverLetterStatusApproved):            ResultCategoryNone,
		string(CoverLetterStatusPendingApproval):     ResultCategoryNone,
		string(ProcessedStatusError):                 ResultCategoryError,
	}

	for status, expected := range tests {
		if got := ResultCategory(status); got != expected {
			t.Fatalf("status %q: expected %q, got %q", status, expected, got)
		}
	}
}

func TestPauseStatusForEventUsesPausedNetworkForBackendNetworkError(t *testing.T) {
	status := PauseStatusForEvent(Event{
		Kind: EventKindError,
		Details: map[string]any{
			"code":   "backend_network_error",
			"safety": "network",
		},
	})
	if status != RunStatusPausedNetwork {
		t.Fatalf("expected paused_network, got %s", status)
	}
}
