package telegram

import (
	"encoding/json"
	"fmt"
	"strings"

	"hh-personal-applier/internal/storage"
)

type Message struct {
	Text    string
	Buttons [][]Button
}

type Button struct {
	Text   string
	Unique string
	Data   string
}

type eventPayload struct {
	RunID       string         `json:"runId,omitempty"`
	VacancyID   string         `json:"vacancyId,omitempty"`
	VacancyURL  string         `json:"vacancyUrl,omitempty"`
	Message     string         `json:"message,omitempty"`
	NonBlocking bool           `json:"nonBlocking,omitempty"`
	Details     map[string]any `json:"details,omitempty"`
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

type coverLetterApprovalPayload struct {
	VacancyID    string `json:"vacancyId"`
	VacancyTitle string `json:"vacancyTitle"`
	VacancyURL   string `json:"vacancyUrl"`
	Body         string `json:"body"`
	Language     string `json:"language"`
	ExpiresAt    string `json:"expiresAt"`
}

const CoverLetterCallbackUnique = "cover_letter_approval"

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
		return formatCoverLetterApproval(notification.Payload)
	default:
		return Message{}, fmt.Errorf("unsupported notification kind %q", notification.Kind)
	}
}

func formatCoverLetterApproval(raw json.RawMessage) (Message, error) {
	var payload coverLetterApprovalPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return Message{}, fmt.Errorf("decode cover letter approval payload: %w", err)
	}
	if payload.VacancyID == "" {
		return Message{}, fmt.Errorf("cover letter approval payload missing vacancyId")
	}

	lines := []string{
		"HH Personal Applier",
		"Cover letter approval",
	}
	if payload.VacancyTitle != "" {
		lines = append(lines, "Vacancy: "+payload.VacancyTitle)
	}
	if payload.VacancyURL != "" {
		lines = append(lines, "URL: "+payload.VacancyURL)
	}
	if payload.ExpiresAt != "" {
		lines = append(lines, "Expires at: "+payload.ExpiresAt)
	}
	lines = append(lines, "", payload.Body)

	return Message{
		Text: strings.Join(lines, "\n"),
		Buttons: [][]Button{{
			{Text: "Отправить", Unique: CoverLetterCallbackUnique, Data: "approve|" + payload.VacancyID},
			{Text: "Пропустить", Unique: CoverLetterCallbackUnique, Data: "skip|" + payload.VacancyID},
		}},
	}, nil
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
	if payload.VacancyURL != "" {
		lines = append(lines, "URL: "+payload.VacancyURL)
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
