package telegram

import (
	"context"
	"log/slog"
	"time"
)

type DailyReportStore interface {
	EnqueueDailyReport(ctx context.Context, date time.Time) error
}

type DailyReporterConfig struct {
	Interval time.Duration
	Logger   *slog.Logger
}

type DailyReporter struct {
	store    DailyReportStore
	location *time.Location
	interval time.Duration
	logger   *slog.Logger
}

func NewDailyReporter(store DailyReportStore, location *time.Location, cfg DailyReporterConfig) *DailyReporter {
	if location == nil {
		location = time.Local
	}
	if cfg.Interval <= 0 {
		cfg.Interval = time.Minute
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return &DailyReporter{
		store:    store,
		location: location,
		interval: cfg.Interval,
		logger:   cfg.Logger,
	}
}

func (r *DailyReporter) Run(ctx context.Context) {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	if err := r.Tick(ctx, time.Now()); err != nil && ctx.Err() == nil {
		r.logger.Error("daily report enqueue failed", "err", err)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if err := r.Tick(ctx, now); err != nil && ctx.Err() == nil {
				r.logger.Error("daily report enqueue failed", "err", err)
			}
		}
	}
}

func (r *DailyReporter) Tick(ctx context.Context, now time.Time) error {
	local := now.In(r.location)
	if local.Hour() != 23 || local.Minute() != 55 {
		return nil
	}
	date := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, r.location)
	return r.store.EnqueueDailyReport(ctx, date)
}
