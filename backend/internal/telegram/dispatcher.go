package telegram

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"hh-personal-applier/internal/storage"
)

type Client interface {
	Send(ctx context.Context, message Message) error
}

type OutboxStore interface {
	ClaimPendingNotifications(ctx context.Context, limit int, now time.Time) ([]storage.Notification, error)
	MarkNotificationSent(ctx context.Context, id string, sentAt time.Time) error
	MarkNotificationFailed(ctx context.Context, id string, lastError string, nextRetryAt time.Time, final bool) error
}

type DispatcherConfig struct {
	Interval    time.Duration
	BatchLimit  int
	MaxAttempts int
	Now         func() time.Time
	Backoff     func(attempts int) time.Duration
	Logger      *slog.Logger
}

type Dispatcher struct {
	store       OutboxStore
	client      Client
	interval    time.Duration
	batchLimit  int
	maxAttempts int
	now         func() time.Time
	backoff     func(attempts int) time.Duration
	logger      *slog.Logger
}

func NewDispatcher(store OutboxStore, client Client, cfg DispatcherConfig) *Dispatcher {
	if cfg.Interval <= 0 {
		cfg.Interval = 5 * time.Second
	}
	if cfg.BatchLimit <= 0 {
		cfg.BatchLimit = 10
	}
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 5
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Backoff == nil {
		cfg.Backoff = defaultBackoff
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return &Dispatcher{
		store:       store,
		client:      client,
		interval:    cfg.Interval,
		batchLimit:  cfg.BatchLimit,
		maxAttempts: cfg.MaxAttempts,
		now:         cfg.Now,
		backoff:     cfg.Backoff,
		logger:      cfg.Logger,
	}
}

func (d *Dispatcher) Run(ctx context.Context) {
	ticker := time.NewTicker(d.interval)
	defer ticker.Stop()

	for {
		if err := d.DispatchOnce(ctx); err != nil && ctx.Err() == nil {
			d.logger.Error("telegram outbox dispatch failed", "err", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (d *Dispatcher) DispatchOnce(ctx context.Context) error {
	now := d.now()
	notifications, err := d.store.ClaimPendingNotifications(ctx, d.batchLimit, now)
	if err != nil {
		return err
	}

	for _, notification := range notifications {
		message, err := FormatNotification(notification)
		if err == nil {
			err = d.client.Send(ctx, message)
		}
		if err == nil {
			if markErr := d.store.MarkNotificationSent(ctx, notification.ID, now); markErr != nil {
				return markErr
			}
			d.logger.Info("telegram notification sent", "notification_id", notification.ID, "kind", notification.Kind)
			continue
		}

		attempts := notification.Attempts + 1
		final := attempts >= d.maxAttempts
		nextRetryAt := now.Add(d.backoff(attempts))
		if markErr := d.store.MarkNotificationFailed(ctx, notification.ID, safeError(err), nextRetryAt, final); markErr != nil {
			return markErr
		}
		d.logger.Warn("telegram notification send failed", "notification_id", notification.ID, "kind", notification.Kind, "attempts", attempts, "final", final, "err", safeError(err))
	}
	return nil
}

func defaultBackoff(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	if attempts > 6 {
		attempts = 6
	}
	return time.Duration(attempts*attempts) * time.Minute
}

func safeError(err error) string {
	if err == nil {
		return ""
	}
	text := strings.TrimSpace(err.Error())
	if len(text) > 500 {
		return text[:500]
	}
	return text
}
