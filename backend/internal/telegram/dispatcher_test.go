package telegram

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"hh-personal-applier/internal/storage"
)

func TestDispatcherSendsPendingNotificationsAndMarksSent(t *testing.T) {
	now := time.Date(2026, 5, 12, 10, 0, 0, 0, time.UTC)
	store := &fakeOutboxStore{
		pending: []storage.Notification{{
			ID:       "n-1",
			Kind:     storage.NotificationKindLoginLost,
			Payload:  json.RawMessage(`{"runId":"run-1","message":"login required"}`),
			Attempts: 0,
		}},
	}
	client := &fakeTelegramClient{}
	dispatcher := NewDispatcher(store, client, DispatcherConfig{
		BatchLimit:  10,
		MaxAttempts: 3,
		Now:         func() time.Time { return now },
		Backoff:     func(int) time.Duration { return 30 * time.Second },
	})

	if err := dispatcher.DispatchOnce(context.Background()); err != nil {
		t.Fatalf("dispatch once: %v", err)
	}

	if len(client.sent) != 1 || client.sent[0].Text == "" {
		t.Fatalf("expected one sent telegram message, got %+v", client.sent)
	}
	if len(store.sent) != 1 || store.sent[0] != "n-1" {
		t.Fatalf("expected notification n-1 to be marked sent, got %+v", store.sent)
	}
	if len(store.failed) != 0 {
		t.Fatalf("expected no failed notifications, got %+v", store.failed)
	}
}

func TestDispatcherBacksOffFailedNotifications(t *testing.T) {
	now := time.Date(2026, 5, 12, 10, 0, 0, 0, time.UTC)
	store := &fakeOutboxStore{
		pending: []storage.Notification{{
			ID:       "n-1",
			Kind:     storage.NotificationKindError,
			Payload:  json.RawMessage(`{"runId":"run-1","message":"dom mismatch"}`),
			Attempts: 1,
		}},
	}
	client := &fakeTelegramClient{sendErr: errors.New("telegram unavailable")}
	dispatcher := NewDispatcher(store, client, DispatcherConfig{
		BatchLimit:  10,
		MaxAttempts: 3,
		Now:         func() time.Time { return now },
		Backoff:     func(attempts int) time.Duration { return time.Duration(attempts) * time.Minute },
	})

	if err := dispatcher.DispatchOnce(context.Background()); err != nil {
		t.Fatalf("dispatch once: %v", err)
	}

	if len(store.sent) != 0 {
		t.Fatalf("expected no sent notifications, got %+v", store.sent)
	}
	if len(store.failed) != 1 {
		t.Fatalf("expected one failed update, got %+v", store.failed)
	}
	failure := store.failed[0]
	if failure.id != "n-1" || failure.final {
		t.Fatalf("expected non-final failure for n-1, got %+v", failure)
	}
	if want := now.Add(2 * time.Minute); !failure.nextRetryAt.Equal(want) {
		t.Fatalf("expected next retry %s, got %s", want, failure.nextRetryAt)
	}
	if !strings.Contains(failure.lastError, "telegram unavailable") {
		t.Fatalf("expected redacted error text to mention failure, got %q", failure.lastError)
	}
}

func TestDispatcherMarksFinalFailureAfterMaxAttempts(t *testing.T) {
	now := time.Date(2026, 5, 12, 10, 0, 0, 0, time.UTC)
	store := &fakeOutboxStore{
		pending: []storage.Notification{{
			ID:       "n-1",
			Kind:     storage.NotificationKindError,
			Payload:  json.RawMessage(`{"message":"network error"}`),
			Attempts: 2,
		}},
	}
	client := &fakeTelegramClient{sendErr: errors.New("telegram unavailable")}
	dispatcher := NewDispatcher(store, client, DispatcherConfig{
		BatchLimit:  10,
		MaxAttempts: 3,
		Now:         func() time.Time { return now },
		Backoff:     func(int) time.Duration { return time.Minute },
	})

	if err := dispatcher.DispatchOnce(context.Background()); err != nil {
		t.Fatalf("dispatch once: %v", err)
	}

	if len(store.failed) != 1 || !store.failed[0].final {
		t.Fatalf("expected final failure after max attempts, got %+v", store.failed)
	}
}

type fakeOutboxStore struct {
	pending []storage.Notification
	sent    []string
	failed  []fakeFailure
}

type fakeFailure struct {
	id          string
	lastError   string
	nextRetryAt time.Time
	final       bool
}

func (f *fakeOutboxStore) ClaimPendingNotifications(_ context.Context, _ int, _ time.Time) ([]storage.Notification, error) {
	return f.pending, nil
}

func (f *fakeOutboxStore) MarkNotificationSent(_ context.Context, id string, _ time.Time) error {
	f.sent = append(f.sent, id)
	return nil
}

func (f *fakeOutboxStore) MarkNotificationFailed(_ context.Context, id string, lastError string, nextRetryAt time.Time, final bool) error {
	f.failed = append(f.failed, fakeFailure{id: id, lastError: lastError, nextRetryAt: nextRetryAt, final: final})
	return nil
}

type fakeTelegramClient struct {
	sendErr error
	sent    []Message
}

func (f *fakeTelegramClient) Send(_ context.Context, message Message) error {
	if f.sendErr != nil {
		return f.sendErr
	}
	f.sent = append(f.sent, message)
	return nil
}
