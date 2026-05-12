package telegram

import (
	"context"
	"testing"
	"time"
)

func TestDailyReporterEnqueuesOnlyAtConfiguredLocalTime(t *testing.T) {
	location := time.FixedZone("test", 3*60*60)
	store := &fakeDailyReportStore{}
	reporter := NewDailyReporter(store, location, DailyReporterConfig{})

	before := time.Date(2026, 5, 12, 23, 54, 0, 0, location)
	if err := reporter.Tick(context.Background(), before); err != nil {
		t.Fatalf("tick before report time: %v", err)
	}
	if len(store.dates) != 0 {
		t.Fatalf("expected no report before 23:55, got %+v", store.dates)
	}

	atReportTime := time.Date(2026, 5, 12, 23, 55, 30, 0, location)
	if err := reporter.Tick(context.Background(), atReportTime); err != nil {
		t.Fatalf("tick at report time: %v", err)
	}
	if len(store.dates) != 1 || store.dates[0] != "2026-05-12" {
		t.Fatalf("expected report for 2026-05-12, got %+v", store.dates)
	}

	after := time.Date(2026, 5, 12, 23, 56, 0, 0, location)
	if err := reporter.Tick(context.Background(), after); err != nil {
		t.Fatalf("tick after report time: %v", err)
	}
	if len(store.dates) != 1 {
		t.Fatalf("expected no duplicate outside report minute, got %+v", store.dates)
	}
}

type fakeDailyReportStore struct {
	dates []string
}

func (f *fakeDailyReportStore) EnqueueDailyReport(_ context.Context, date time.Time) error {
	f.dates = append(f.dates, date.Format("2006-01-02"))
	return nil
}
