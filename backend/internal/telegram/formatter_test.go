package telegram

import (
	"encoding/json"
	"strings"
	"testing"

	"hh-personal-applier/internal/storage"
)

func TestFormatNotificationBuildsSafetyEventMessage(t *testing.T) {
	payload := json.RawMessage(`{"runId":"run-1","vacancyId":"42","vacancyUrl":"https://hh.ru/vacancy/42","message":"captcha visible"}`)

	message, err := FormatNotification(storage.Notification{
		Kind:    storage.NotificationKindCaptcha,
		Payload: payload,
	})
	if err != nil {
		t.Fatalf("expected captcha notification to format, got %v", err)
	}

	for _, want := range []string{"CAPTCHA", "run-1", "42", "https://hh.ru/vacancy/42", "captcha visible"} {
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

func TestFormatNotificationBuildsCoverLetterApprovalMessageWithButtons(t *testing.T) {
	message, err := FormatNotification(storage.Notification{
		Kind: storage.NotificationKindCoverLetterApproval,
		Payload: json.RawMessage(`{
			"vacancyId":"42",
			"vacancyTitle":"Go Backend Developer",
			"vacancyUrl":"https://hh.ru/vacancy/42",
			"body":"Здравствуйте! Могу быть полезен в backend задачах.",
			"language":"ru",
			"expiresAt":"2026-05-12T13:00:00Z"
		}`),
	})
	if err != nil {
		t.Fatalf("expected cover letter approval to format, got %v", err)
	}

	for _, want := range []string{"Go Backend Developer", "https://hh.ru/vacancy/42", "Здравствуйте"} {
		if !strings.Contains(message.Text, want) {
			t.Fatalf("expected message %q to contain %q", message.Text, want)
		}
	}
	if len(message.Buttons) != 1 || len(message.Buttons[0]) != 2 {
		t.Fatalf("expected one row with two buttons, got %+v", message.Buttons)
	}
	if message.Buttons[0][0].Data != "approve|42" ||
		message.Buttons[0][1].Data != "skip|42" {
		t.Fatalf("unexpected buttons: %+v", message.Buttons)
	}
}
