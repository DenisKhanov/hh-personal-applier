package telegram

import (
	"encoding/json"
	"fmt"
	"strings"

	"hh-personal-applier/internal/storage"
)

type Message struct {
	Text string
}

type eventPayload struct {
	RunID     string         `json:"runId,omitempty"`
	VacancyID string         `json:"vacancyId,omitempty"`
	Message   string         `json:"message,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
}

type dailyLimitPayload struct {
	Date       string `json:"date"`
	RunID      string `json:"runId,omitempty"`
	Applied    int    `json:"applied"`
	DailyLimit int    `json:"dailyLimit"`
}

type dailyReportPayload struct {
	Date           string `json:"date"`
	Applied        int    `json:"applied"`
	Skipped        int    `json:"skipped"`
	Errors         int    `json:"errors"`
	RemainingDaily int    `json:"remainingDaily"`
}

type telegramTestPayload struct {
	CreatedAt string `json:"createdAt"`
}

func FormatNotification(notification storage.Notification) (Message, error) {
	switch notification.Kind {
	case storage.NotificationKindCaptcha:
		return formatEvent(notification.Payload, "CAPTCHA detected")
	case storage.NotificationKindLoginLost:
		return formatEvent(notification.Payload, "Login lost")
	case storage.NotificationKindError:
		return formatEvent(notification.Payload, "Error")
	case storage.NotificationKindDailyLimitReached:
		return formatDailyLimit(notification.Payload)
	case storage.NotificationKindDailyReport:
		return formatDailyReport(notification.Payload)
	case storage.NotificationKindTelegramTest:
		return formatTelegramTest(notification.Payload)
	case storage.NotificationKindCoverLetterApproval:
		return Message{}, fmt.Errorf("cover_letter_approval notifications are implemented in stage 7")
	default:
		return Message{}, fmt.Errorf("unsupported notification kind %q", notification.Kind)
	}
}

func formatTelegramTest(raw json.RawMessage) (Message, error) {
	var payload telegramTestPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return Message{}, fmt.Errorf("decode telegram test payload: %w", err)
	}

	lines := []string{
		"Привет!",
		"HH Personal Applier на связи.",
		"Telegram уведомления настроены.",
	}
	if payload.CreatedAt != "" {
		lines = append(lines, "Создано: "+payload.CreatedAt)
	}
	return Message{Text: strings.Join(lines, "\n")}, nil
}

func formatEvent(raw json.RawMessage, title string) (Message, error) {
	var payload eventPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return Message{}, fmt.Errorf("decode event payload: %w", err)
	}

	lines := []string{"HH Personal Applier", title}
	if payload.RunID != "" {
		lines = append(lines, "Run: "+payload.RunID)
	}
	if payload.VacancyID != "" {
		lines = append(lines, "Vacancy: "+payload.VacancyID)
	}
	if payload.Message != "" {
		lines = append(lines, "Message: "+payload.Message)
	}
	return Message{Text: strings.Join(lines, "\n")}, nil
}

func formatDailyLimit(raw json.RawMessage) (Message, error) {
	var payload dailyLimitPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return Message{}, fmt.Errorf("decode daily limit payload: %w", err)
	}

	lines := []string{
		"HH Personal Applier",
		"Daily limit reached",
		"Date: " + payload.Date,
		fmt.Sprintf("Applied: %d", payload.Applied),
		fmt.Sprintf("Daily limit: %d", payload.DailyLimit),
	}
	if payload.RunID != "" {
		lines = append(lines, "Run: "+payload.RunID)
	}
	return Message{Text: strings.Join(lines, "\n")}, nil
}

func formatDailyReport(raw json.RawMessage) (Message, error) {
	var payload dailyReportPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return Message{}, fmt.Errorf("decode daily report payload: %w", err)
	}

	return Message{Text: strings.Join([]string{
		"HH Personal Applier",
		"Daily report",
		"Date: " + payload.Date,
		fmt.Sprintf("Applied: %d", payload.Applied),
		fmt.Sprintf("Skipped: %d", payload.Skipped),
		fmt.Sprintf("Errors: %d", payload.Errors),
		fmt.Sprintf("Remaining daily: %d", payload.RemainingDaily),
	}, "\n")}, nil
}
