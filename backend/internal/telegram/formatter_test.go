package telegram

import (
	"encoding/json"
	"strings"
	"testing"

	"hh-personal-applier/internal/storage"
)

func TestFormatNotificationBuildsSafetyEventMessage(t *testing.T) {
	payload := json.RawMessage(`{"runId":"run-1","vacancyId":"42","message":"captcha visible"}`)

	message, err := FormatNotification(storage.Notification{
		Kind:    storage.NotificationKindCaptcha,
		Payload: payload,
	})
	if err != nil {
		t.Fatalf("expected captcha notification to format, got %v", err)
	}

	for _, want := range []string{"CAPTCHA", "run-1", "42", "captcha visible"} {
		if !strings.Contains(message.Text, want) {
			t.Fatalf("expected message %q to contain %q", message.Text, want)
		}
	}
}

func TestFormatNotificationBuildsDailyReportMessage(t *testing.T) {
	payload := json.RawMessage(`{"date":"2026-05-12","applied":7,"skipped":2,"errors":1,"remainingDaily":93}`)

	message, err := FormatNotification(storage.Notification{
		Kind:    storage.NotificationKindDailyReport,
		Payload: payload,
	})
	if err != nil {
		t.Fatalf("expected daily report to format, got %v", err)
	}

	for _, want := range []string{"Daily report", "2026-05-12", "Applied: 7", "Skipped: 2", "Errors: 1", "Remaining daily: 93"} {
		if !strings.Contains(message.Text, want) {
			t.Fatalf("expected message %q to contain %q", message.Text, want)
		}
	}
}

func TestFormatNotificationBuildsTelegramTestGreeting(t *testing.T) {
	payload := json.RawMessage(`{"createdAt":"2026-05-12T01:50:00+03:00"}`)

	message, err := FormatNotification(storage.Notification{
		Kind:    storage.NotificationKindTelegramTest,
		Payload: payload,
	})
	if err != nil {
		t.Fatalf("expected telegram test notification to format, got %v", err)
	}

	for _, want := range []string{"Привет", "HH Personal Applier", "Telegram уведомления настроены"} {
		if !strings.Contains(message.Text, want) {
			t.Fatalf("expected message %q to contain %q", message.Text, want)
		}
	}
}

func TestFormatNotificationRejectsCoverLetterApprovalUntilStage7(t *testing.T) {
	_, err := FormatNotification(storage.Notification{
		Kind:    storage.NotificationKindCoverLetterApproval,
		Payload: json.RawMessage(`{}`),
	})
	if err == nil {
		t.Fatal("expected cover letter approval formatting to wait for stage 7")
	}
}
