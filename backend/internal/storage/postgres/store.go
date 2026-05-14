package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"

	"hh-personal-applier/internal/storage"
)

type Store struct {
	db       *sql.DB
	location *time.Location
}

func New(db *sql.DB, location *time.Location) *Store {
	if location == nil {
		location = time.Local
	}
	return &Store{db: db, location: location}
}

func (s *Store) GetSettings(ctx context.Context) (storage.Settings, error) {
	return getSettings(ctx, s.db)
}

func (s *Store) GetRunSettings(ctx context.Context, runID string) (storage.Settings, error) {
	run, err := s.getRun(ctx, runID)
	if err != nil {
		return storage.Settings{}, err
	}
	return run.SettingsSnapshot, nil
}

func (s *Store) UpdateSettings(ctx context.Context, settings storage.Settings) (storage.Settings, error) {
	if err := storage.ValidateSettings(settings); err != nil {
		return storage.Settings{}, err
	}

	row := s.db.QueryRowContext(ctx, `
		UPDATE owner_settings
		SET daily_limit = $1,
		    run_limit = $2,
		    pace_min_seconds = $3,
		    pace_max_seconds = $4,
		    skip_with_test = $5,
		    skip_external = $6,
		    require_cover_letter_approval = $7,
		    auto_apply = $8,
		    updated_at = now()
		WHERE id = TRUE
		RETURNING daily_limit, run_limit, pace_min_seconds, pace_max_seconds,
		          skip_with_test, skip_external, require_cover_letter_approval, auto_apply`,
		settings.DailyLimit,
		settings.RunLimit,
		settings.PaceMinSeconds,
		settings.PaceMaxSeconds,
		settings.SkipWithTest,
		settings.SkipExternal,
		settings.RequireCoverLetterApproval,
		settings.AutoApply,
	)
	updated, err := scanSettings(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return storage.Settings{}, storage.NewNotFound("settings_not_found", "owner settings not found")
		}
		return storage.Settings{}, err
	}
	return updated, nil
}

func (s *Store) StartRun(ctx context.Context, searchURL string) (storage.Run, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return storage.Run{}, err
	}
	defer rollback(tx)

	var activeID string
	err = tx.QueryRowContext(ctx, `
		SELECT id::text
		FROM apply_runs
		WHERE status IN ('running', 'paused_captcha', 'paused_unknown', 'paused_network')
		LIMIT 1`).Scan(&activeID)
	if err == nil {
		return storage.Run{}, storage.NewConflict("active_run_exists", "an active run already exists")
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return storage.Run{}, err
	}

	settings, err := getSettings(ctx, tx)
	if err != nil {
		return storage.Run{}, err
	}
	snapshot, err := json.Marshal(settings)
	if err != nil {
		return storage.Run{}, err
	}

	run, err := scanRun(tx.QueryRowContext(ctx, `
		INSERT INTO apply_runs (search_url, settings_snapshot)
		VALUES ($1, $2)
		RETURNING id::text, status, search_url, settings_snapshot,
		          applied_count, skipped_count, error_count, stop_reason`,
		searchURL,
		snapshot,
	))
	if err != nil {
		if isUniqueViolation(err) {
			return storage.Run{}, storage.NewConflict("active_run_exists", "an active run already exists")
		}
		return storage.Run{}, err
	}

	if err := tx.Commit(); err != nil {
		return storage.Run{}, err
	}
	return run, nil
}

func (s *Store) StopRun(ctx context.Context, runID string, reason string) (storage.Run, error) {
	if err := storage.ValidateStopReason(reason); err != nil {
		return storage.Run{}, err
	}
	status := storage.StopStatusForReason(reason)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return storage.Run{}, err
	}
	defer rollback(tx)

	run, err := scanRun(tx.QueryRowContext(ctx, `
		UPDATE apply_runs
		SET status = $2, stop_reason = $3, stopped_at = now()
		WHERE id = $1
		  AND status IN ('running', 'paused_captcha', 'paused_unknown', 'paused_network')
		RETURNING id::text, status, search_url, settings_snapshot,
		          applied_count, skipped_count, error_count, stop_reason`,
		runID,
		string(status),
		reason,
	))
	if err == nil {
		if reason == "daily_limit_reached" {
			if err := s.enqueueDailyLimitReached(ctx, tx, run); err != nil {
				return storage.Run{}, err
			}
		}
		if err := tx.Commit(); err != nil {
			return storage.Run{}, err
		}
		return run, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return storage.Run{}, err
	}

	run, err = s.getRun(ctx, runID)
	if err != nil {
		return storage.Run{}, err
	}
	return run, nil
}

func (s *Store) ContinueRun(ctx context.Context, runID string) (storage.Run, error) {
	run, err := scanRun(s.db.QueryRowContext(ctx, `
		UPDATE apply_runs
		SET status = 'running'
		WHERE id = $1
		  AND status IN ('paused_captcha', 'paused_unknown', 'paused_network')
		RETURNING id::text, status, search_url, settings_snapshot,
		          applied_count, skipped_count, error_count, stop_reason`,
		runID,
	))
	if err == nil {
		return run, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return storage.Run{}, err
	}

	if _, getErr := s.getRun(ctx, runID); getErr != nil {
		return storage.Run{}, getErr
	}
	return storage.Run{}, storage.NewConflict("run_not_paused", "run is not paused")
}

func (s *Store) FilterCandidates(ctx context.Context, runID string, items []storage.CandidateItem) (storage.CandidatesResult, error) {
	run, err := s.getRun(ctx, runID)
	if err != nil {
		return storage.CandidatesResult{}, err
	}
	if run.Status != storage.RunStatusRunning {
		return storage.CandidatesResult{}, storage.NewConflict("run_not_running", "run is not running")
	}

	today := s.today()
	dailyApplied, err := s.dailyAppliedCount(ctx, today)
	if err != nil {
		return storage.CandidatesResult{}, err
	}

	remainingDaily := max(run.SettingsSnapshot.DailyLimit-dailyApplied, 0)
	remainingRun := max(run.SettingsSnapshot.RunLimit-run.AppliedCount, 0)
	capacity := min(remainingDaily, remainingRun)

	processed, err := s.processedStatuses(ctx, items)
	if err != nil {
		return storage.CandidatesResult{}, err
	}

	result := storage.CandidatesResult{
		Allow:          []string{},
		Rejected:       []storage.CandidateRejection{},
		RemainingDaily: remainingDaily,
		RemainingRun:   remainingRun,
	}

	for _, item := range items {
		if status, ok := processed[item.VacancyID]; ok {
			if status == storage.ProcessedStatusAttempting {
				// Vacancies stuck in "attempting" from a previous interrupted run
				// should be retried, not skipped.
			} else {
				result.Rejected = append(result.Rejected, storage.CandidateRejection{
					VacancyID: item.VacancyID,
					Reason:    "already_processed",
					Status:    string(status),
				})
				continue
			}
		}
		if item.IsArchived {
			result.Rejected = append(result.Rejected, storage.CandidateRejection{VacancyID: item.VacancyID, Reason: "archived"})
			continue
		}
		if item.HasTest && run.SettingsSnapshot.SkipWithTest {
			result.Rejected = append(result.Rejected, storage.CandidateRejection{VacancyID: item.VacancyID, Reason: "has_test"})
			continue
		}
		if item.IsExternal && run.SettingsSnapshot.SkipExternal {
			result.Rejected = append(result.Rejected, storage.CandidateRejection{VacancyID: item.VacancyID, Reason: "external"})
			continue
		}
		if len(result.Allow) >= capacity {
			reason := "run_limit"
			if remainingDaily <= remainingRun {
				reason = "daily_limit"
			}
			result.Rejected = append(result.Rejected, storage.CandidateRejection{VacancyID: item.VacancyID, Reason: reason})
			continue
		}
		result.Allow = append(result.Allow, item.VacancyID)
	}

	return result, nil
}

func (s *Store) StartAttempt(ctx context.Context, attempt storage.AttemptStart) (storage.AttemptStartResult, error) {
	run, err := s.getRun(ctx, attempt.RunID)
	if err != nil {
		return storage.AttemptStartResult{}, err
	}
	if run.Status != storage.RunStatusRunning {
		return storage.AttemptStartResult{}, storage.NewConflict("run_not_running", "run is not running")
	}

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO processed_vacancies (
		    vacancy_id, run_id, status, vacancy_title, employer_name, vacancy_url,
		    notes, attempt_started_at, updated_at
		)
		VALUES ($1, $2, 'attempting', $3, $4, $5, $6, now(), now())
		ON CONFLICT (vacancy_id)
		DO UPDATE SET run_id = EXCLUDED.run_id,
		              status = EXCLUDED.status,
		              vacancy_title = COALESCE(NULLIF(EXCLUDED.vacancy_title, ''), processed_vacancies.vacancy_title),
		              employer_name = COALESCE(NULLIF(EXCLUDED.employer_name, ''), processed_vacancies.employer_name),
		              vacancy_url = COALESCE(NULLIF(EXCLUDED.vacancy_url, ''), processed_vacancies.vacancy_url),
		              notes = COALESCE(NULLIF(EXCLUDED.notes, ''), processed_vacancies.notes),
		              attempt_started_at = now(),
		              updated_at = now()
		WHERE processed_vacancies.status = 'attempting'`,
		attempt.VacancyID,
		attempt.RunID,
		nullIfEmpty(attempt.VacancyTitle),
		nullIfEmpty(attempt.EmployerName),
		nullIfEmpty(attempt.VacancyURL),
		nullIfEmpty(attempt.Notes),
	)
	if err != nil {
		return storage.AttemptStartResult{}, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return storage.AttemptStartResult{}, err
	}
	if rows == 1 {
		return storage.AttemptStartResult{Started: true}, nil
	}

	// rows == 0: either already_attempting in the same run, or a terminal status.
	var existingStatus string
	var existingRunID sql.NullString
	if err := s.db.QueryRowContext(ctx, `
		SELECT status, run_id::text
		FROM processed_vacancies
		WHERE vacancy_id = $1`,
		attempt.VacancyID,
	).Scan(&existingStatus, &existingRunID); err != nil {
		return storage.AttemptStartResult{}, err
	}
	if existingStatus == string(storage.ProcessedStatusAttempting) && existingRunID.Valid && existingRunID.String == attempt.RunID {
		return storage.AttemptStartResult{Started: false, Reason: "already_attempting"}, nil
	}

	return storage.AttemptStartResult{}, storage.NewConflict("vacancy_already_processed", "vacancy already processed")
}

func (s *Store) FinalizeVacancyResult(ctx context.Context, result storage.VacancyResult) (storage.VacancyResultOutcome, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return storage.VacancyResultOutcome{}, err
	}
	defer rollback(tx)

	if _, err := getRun(ctx, tx, result.RunID); err != nil {
		return storage.VacancyResultOutcome{}, err
	}

	oldStatus, exists, err := getProcessedForUpdate(ctx, tx, result.VacancyID)
	if err != nil {
		return storage.VacancyResultOutcome{}, err
	}

	if exists && oldStatus == result.Status {
		if err := tx.Commit(); err != nil {
			return storage.VacancyResultOutcome{}, err
		}
		return storage.VacancyResultOutcome{Status: result.Status, Idempotent: true}, nil
	}

	if exists && storage.IsTerminalStatus(oldStatus) {
		canManualOverride := result.ManualOverride &&
			oldStatus == string(storage.ProcessedStatusUnknownAfterClick) &&
			(result.Status == string(storage.ProcessedStatusApplied) || result.Status == string(storage.ProcessedStatusSkipped))
		if !canManualOverride {
			return storage.VacancyResultOutcome{}, storage.NewConflict("vacancy_already_finalized", "vacancy already has a terminal status")
		}
	}

	if exists {
		if _, err := tx.ExecContext(ctx, `
			UPDATE processed_vacancies
			SET run_id = $2,
			    status = $3,
			    vacancy_title = COALESCE(NULLIF($4, ''), vacancy_title),
			    employer_name = COALESCE(NULLIF($5, ''), employer_name),
			    vacancy_url = COALESCE(NULLIF($6, ''), vacancy_url),
			    notes = COALESCE(NULLIF($7, ''), notes),
			    applied_at = CASE WHEN $3 = 'applied' THEN now() ELSE applied_at END,
			    updated_at = now()
			WHERE vacancy_id = $1`,
			result.VacancyID,
			result.RunID,
			result.Status,
			result.VacancyTitle,
			result.EmployerName,
			result.VacancyURL,
			result.Notes,
		); err != nil {
			return storage.VacancyResultOutcome{}, err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO processed_vacancies (
			    vacancy_id, run_id, status, vacancy_title, employer_name, vacancy_url,
			    notes, applied_at, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7,
			        CASE WHEN $3 = 'applied' THEN now() ELSE NULL END,
			        now())`,
			result.VacancyID,
			result.RunID,
			result.Status,
			nullIfEmpty(result.VacancyTitle),
			nullIfEmpty(result.EmployerName),
			nullIfEmpty(result.VacancyURL),
			nullIfEmpty(result.Notes),
		); err != nil {
			return storage.VacancyResultOutcome{}, err
		}
	}

	oldCategory := storage.ResultCategory(oldStatus)
	if !exists {
		oldCategory = storage.ResultCategoryNone
	}
	newCategory := storage.ResultCategory(result.Status)
	if err := s.applyCounterDelta(ctx, tx, result.RunID, oldCategory, newCategory); err != nil {
		return storage.VacancyResultOutcome{}, err
	}

	if err := tx.Commit(); err != nil {
		return storage.VacancyResultOutcome{}, err
	}
	return storage.VacancyResultOutcome{
		Status:  result.Status,
		Counted: oldCategory != newCategory,
	}, nil
}

func (s *Store) GetTodayStats(ctx context.Context) (storage.TodayStats, error) {
	today := s.today()

	var stats storage.TodayStats
	err := s.db.QueryRowContext(ctx, `
		SELECT applied_count, skipped_count, error_count
		FROM daily_apply_stats
		WHERE date = $1`,
		today,
	).Scan(&stats.Applied, &stats.Skipped, &stats.Errors)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return storage.TodayStats{}, err
	}

	active, err := s.activeRun(ctx)
	if err != nil {
		return storage.TodayStats{}, err
	}
	stats.ActiveRun = active

	dailyLimit := 100
	if active != nil {
		dailyLimit = active.SettingsSnapshot.DailyLimit
	} else if settings, err := s.GetSettings(ctx); err == nil {
		dailyLimit = settings.DailyLimit
	}
	stats.RemainingDaily = max(dailyLimit-stats.Applied, 0)
	recent, err := s.recentProcessedVacancies(ctx, 10)
	if err != nil {
		return storage.TodayStats{}, err
	}
	stats.RecentVacancies = recent

	return stats, nil
}

func (s *Store) recentProcessedVacancies(ctx context.Context, limit int) ([]storage.ProcessedVacancy, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT vacancy_id, run_id::text, status, vacancy_title, employer_name, vacancy_url,
		       notes, applied_at, updated_at
		FROM processed_vacancies
		ORDER BY updated_at DESC
		LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	vacancies := make([]storage.ProcessedVacancy, 0, limit)
	for rows.Next() {
		var vacancy storage.ProcessedVacancy
		var runID sql.NullString
		var title sql.NullString
		var employer sql.NullString
		var url sql.NullString
		var notes sql.NullString
		var appliedAt sql.NullTime
		if err := rows.Scan(
			&vacancy.VacancyID,
			&runID,
			&vacancy.Status,
			&title,
			&employer,
			&url,
			&notes,
			&appliedAt,
			&vacancy.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if runID.Valid {
			vacancy.RunID = runID.String
		}
		if title.Valid {
			vacancy.VacancyTitle = title.String
		}
		if employer.Valid {
			vacancy.EmployerName = employer.String
		}
		if url.Valid {
			vacancy.VacancyURL = url.String
		}
		if notes.Valid {
			vacancy.Notes = notes.String
		}
		if appliedAt.Valid {
			vacancy.AppliedAt = appliedAt.Time
		}
		vacancies = append(vacancies, vacancy)
	}
	return vacancies, rows.Err()
}

func (s *Store) RecordEvent(ctx context.Context, event storage.Event) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer rollback(tx)

	if event.RunID != "" && !event.NonBlocking {
		status := storage.RunStatusPausedUnknown
		if event.Kind == storage.EventKindCaptcha {
			status = storage.RunStatusPausedCaptcha
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE apply_runs
			SET status = $2
			WHERE id = $1
			  AND status = 'running'`,
			event.RunID,
			string(status),
		); err != nil {
			return err
		}
	}

	var dedupKey sql.NullString
	if event.RunID != "" {
		dedupKey = sql.NullString{String: fmt.Sprintf("%s:%s", event.Kind, event.RunID), Valid: true}
		if event.NonBlocking && event.VacancyID != "" {
			dedupKey = sql.NullString{String: fmt.Sprintf("%s:%s:%s", event.Kind, event.RunID, event.VacancyID), Valid: true}
		}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO notifications_outbox (kind, payload, dedup_key)
		VALUES ($1, $2, $3)
		ON CONFLICT (dedup_key) DO NOTHING`,
		string(event.Kind),
		payload,
		dedupKey,
	); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Store) ClaimPendingNotifications(ctx context.Context, limit int, now time.Time) ([]storage.Notification, error) {
	if limit <= 0 {
		limit = 10
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, kind, payload, attempts
		FROM notifications_outbox
		WHERE status = 'pending'
		  AND next_retry_at <= $1
		ORDER BY created_at
		LIMIT $2`,
		now,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notifications := []storage.Notification{}
	for rows.Next() {
		var notification storage.Notification
		var kind string
		var payload []byte
		if err := rows.Scan(&notification.ID, &kind, &payload, &notification.Attempts); err != nil {
			return nil, err
		}
		notification.Kind = storage.NotificationKind(kind)
		notification.Payload = append(json.RawMessage(nil), payload...)
		notifications = append(notifications, notification)
	}
	return notifications, rows.Err()
}

func (s *Store) MarkNotificationSent(ctx context.Context, id string, sentAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE notifications_outbox
		SET status = 'sent',
		    sent_at = $2,
		    last_error = NULL
		WHERE id = $1
		  AND status = 'pending'`,
		id,
		sentAt,
	)
	return err
}

func (s *Store) MarkNotificationFailed(ctx context.Context, id string, lastError string, nextRetryAt time.Time, final bool) error {
	status := "pending"
	if final {
		status = "failed"
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE notifications_outbox
		SET status = $2,
		    attempts = attempts + 1,
		    last_error = $3,
		    next_retry_at = $4
		WHERE id = $1
		  AND status = 'pending'`,
		id,
		status,
		nullIfEmpty(lastError),
		nextRetryAt,
	)
	return err
}

func (s *Store) EnqueueDailyReport(ctx context.Context, reportDate time.Time) error {
	date := localDate(reportDate.In(s.location), s.location)
	dateString := date.Format("2006-01-02")

	var applied int
	var skipped int
	var failures int
	err := s.db.QueryRowContext(ctx, `
		SELECT applied_count, skipped_count, error_count
		FROM daily_apply_stats
		WHERE date = $1`,
		date,
	).Scan(&applied, &skipped, &failures)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	settings, err := s.GetSettings(ctx)
	if err != nil {
		return err
	}

	payload := map[string]any{
		"date":           dateString,
		"applied":        applied,
		"skipped":        skipped,
		"errors":         failures,
		"remainingDaily": max(settings.DailyLimit-applied, 0),
	}
	return enqueueNotification(ctx, s.db, storage.NotificationKindDailyReport, payload, fmt.Sprintf("%s:%s", storage.NotificationKindDailyReport, dateString))
}

func (s *Store) QueueTelegramTest(ctx context.Context) (storage.NotificationQueueResult, error) {
	payload := map[string]any{
		"createdAt": time.Now().In(s.location).Format(time.RFC3339),
	}
	if err := enqueueNotification(ctx, s.db, storage.NotificationKindTelegramTest, payload, ""); err != nil {
		return storage.NotificationQueueResult{}, err
	}
	return storage.NotificationQueueResult{Queued: true}, nil
}

func (s *Store) CreateCoverLetter(ctx context.Context, create storage.CoverLetterCreate) (storage.CoverLetter, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return storage.CoverLetter{}, false, err
	}
	defer rollback(tx)

	letter, err := scanCoverLetter(tx.QueryRowContext(ctx, `
		INSERT INTO cover_letters (
		    vacancy_id, vacancy_title, body, language, status, expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (vacancy_id) DO NOTHING
		RETURNING id::text, vacancy_id, vacancy_title, body, language, status, expires_at, created_at`,
		create.VacancyID,
		nullIfEmpty(create.VacancyTitle),
		create.Body,
		string(create.Language),
		string(create.Status),
		create.ExpiresAt,
	))
	created := true
	if errors.Is(err, sql.ErrNoRows) {
		created = false
		letter, err = getCoverLetter(ctx, tx, create.VacancyID)
	}
	if err != nil {
		return storage.CoverLetter{}, false, err
	}

	if created && create.Status == storage.CoverLetterStatusPendingApproval {
		payload := storage.CoverLetterApprovalNotification{
			VacancyID:    letter.VacancyID,
			VacancyTitle: letter.VacancyTitle,
			VacancyURL:   create.VacancyURL,
			Body:         letter.Body,
			Language:     letter.Language,
			ExpiresAt:    letter.ExpiresAt,
		}
		if err := enqueueNotification(ctx, tx, storage.NotificationKindCoverLetterApproval, payload, "cover_letter_approval:"+letter.VacancyID); err != nil {
			return storage.CoverLetter{}, false, err
		}
		letter.ApprovalQueued = true
	}

	if err := tx.Commit(); err != nil {
		return storage.CoverLetter{}, false, err
	}
	return letter, created, nil
}

func (s *Store) GetCoverLetter(ctx context.Context, vacancyID string, now time.Time) (storage.CoverLetter, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return storage.CoverLetter{}, err
	}
	defer rollback(tx)

	if err := expireCoverLetter(ctx, tx, vacancyID, now); err != nil {
		return storage.CoverLetter{}, err
	}
	letter, err := getCoverLetter(ctx, tx, vacancyID)
	if err != nil {
		return storage.CoverLetter{}, err
	}
	if err := tx.Commit(); err != nil {
		return storage.CoverLetter{}, err
	}
	return letter, nil
}

func (s *Store) ResolveCoverLetter(ctx context.Context, vacancyID string, status storage.CoverLetterStatus, now time.Time) (storage.CoverLetter, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return storage.CoverLetter{}, false, err
	}
	defer rollback(tx)

	if err := expireCoverLetter(ctx, tx, vacancyID, now); err != nil {
		return storage.CoverLetter{}, false, err
	}

	letter, err := scanCoverLetter(tx.QueryRowContext(ctx, `
		UPDATE cover_letters
		SET status = $2
		WHERE vacancy_id = $1
		  AND status = 'pending_approval'
		  AND expires_at > $3
		RETURNING id::text, vacancy_id, vacancy_title, body, language, status, expires_at, created_at`,
		vacancyID,
		string(status),
		now,
	))
	changed := true
	if errors.Is(err, sql.ErrNoRows) {
		changed = false
		letter, err = getCoverLetter(ctx, tx, vacancyID)
	}
	if err != nil {
		return storage.CoverLetter{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return storage.CoverLetter{}, false, err
	}
	return letter, changed, nil
}

func (s *Store) QueueLLMRateLimitAlert(ctx context.Context, runID string) error {
	payload := map[string]any{
		"runId":   runID,
		"message": "Groq rate limit reached; letter-required vacancies will be skipped until the next Start.",
	}
	dedupKey := "llm_rate_limit"
	if runID != "" {
		dedupKey = "llm_rate_limit:" + runID
	}
	return enqueueNotification(ctx, s.db, storage.NotificationKindError, payload, dedupKey)
}

type settingsScanner interface {
	Scan(dest ...any) error
}

type queryRower interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func getSettings(ctx context.Context, q queryRower) (storage.Settings, error) {
	settings, err := scanSettings(q.QueryRowContext(ctx, `
		SELECT daily_limit, run_limit, pace_min_seconds, pace_max_seconds,
		       skip_with_test, skip_external, require_cover_letter_approval, auto_apply
		FROM owner_settings
		WHERE id = TRUE`))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return storage.Settings{}, storage.NewNotFound("settings_not_found", "owner settings not found")
		}
		return storage.Settings{}, err
	}
	return settings, nil
}

func scanSettings(row settingsScanner) (storage.Settings, error) {
	var settings storage.Settings
	err := row.Scan(
		&settings.DailyLimit,
		&settings.RunLimit,
		&settings.PaceMinSeconds,
		&settings.PaceMaxSeconds,
		&settings.SkipWithTest,
		&settings.SkipExternal,
		&settings.RequireCoverLetterApproval,
		&settings.AutoApply,
	)
	return settings, err
}

func (s *Store) getRun(ctx context.Context, runID string) (storage.Run, error) {
	return getRun(ctx, s.db, runID)
}

func getRun(ctx context.Context, q queryRower, runID string) (storage.Run, error) {
	run, err := scanRun(q.QueryRowContext(ctx, `
		SELECT id::text, status, search_url, settings_snapshot,
		       applied_count, skipped_count, error_count, stop_reason
		FROM apply_runs
		WHERE id = $1`,
		runID,
	))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return storage.Run{}, storage.NewNotFound("run_not_found", "run not found")
		}
		return storage.Run{}, err
	}
	return run, nil
}

func scanRun(row settingsScanner) (storage.Run, error) {
	var run storage.Run
	var snapshot []byte
	var status string
	var stopReason sql.NullString
	if err := row.Scan(
		&run.ID,
		&status,
		&run.SearchURL,
		&snapshot,
		&run.AppliedCount,
		&run.SkippedCount,
		&run.ErrorCount,
		&stopReason,
	); err != nil {
		return storage.Run{}, err
	}
	if err := json.Unmarshal(snapshot, &run.SettingsSnapshot); err != nil {
		return storage.Run{}, err
	}
	run.Status = storage.RunStatus(status)
	if stopReason.Valid {
		run.StopReason = stopReason.String
	}
	return run, nil
}

func getCoverLetter(ctx context.Context, q queryRower, vacancyID string) (storage.CoverLetter, error) {
	letter, err := scanCoverLetter(q.QueryRowContext(ctx, `
		SELECT id::text, vacancy_id, vacancy_title, body, language, status, expires_at, created_at
		FROM cover_letters
		WHERE vacancy_id = $1`,
		vacancyID,
	))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return storage.CoverLetter{}, storage.NewNotFound("cover_letter_not_found", "cover letter not found")
		}
		return storage.CoverLetter{}, err
	}
	return letter, nil
}

func scanCoverLetter(row settingsScanner) (storage.CoverLetter, error) {
	var letter storage.CoverLetter
	var title sql.NullString
	var language string
	var status string
	err := row.Scan(
		&letter.ID,
		&letter.VacancyID,
		&title,
		&letter.Body,
		&language,
		&status,
		&letter.ExpiresAt,
		&letter.CreatedAt,
	)
	if err != nil {
		return storage.CoverLetter{}, err
	}
	if title.Valid {
		letter.VacancyTitle = title.String
	}
	letter.Language = storage.CoverLetterLanguage(language)
	letter.Status = storage.CoverLetterStatus(status)
	return letter, nil
}

func expireCoverLetter(ctx context.Context, tx *sql.Tx, vacancyID string, now time.Time) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE cover_letters
		SET status = 'expired'
		WHERE vacancy_id = $1
		  AND status = 'pending_approval'
		  AND expires_at <= $2`,
		vacancyID,
		now,
	)
	return err
}

func (s *Store) dailyAppliedCount(ctx context.Context, today time.Time) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT applied_count
		FROM daily_apply_stats
		WHERE date = $1`,
		today,
	).Scan(&count)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	return count, nil
}

func (s *Store) processedStatuses(ctx context.Context, items []storage.CandidateItem) (map[string]storage.ProcessedStatus, error) {
	statuses := make(map[string]storage.ProcessedStatus)
	ids := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if item.VacancyID == "" {
			continue
		}
		if _, ok := seen[item.VacancyID]; ok {
			continue
		}
		seen[item.VacancyID] = struct{}{}
		ids = append(ids, item.VacancyID)
	}
	if len(ids) == 0 {
		return statuses, nil
	}

	query, args := inQuery(`
		SELECT vacancy_id, status
		FROM processed_vacancies
		WHERE vacancy_id IN (%s)`, ids)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var vacancyID string
		var status string
		if err := rows.Scan(&vacancyID, &status); err != nil {
			return nil, err
		}
		statuses[vacancyID] = storage.ProcessedStatus(status)
	}
	return statuses, rows.Err()
}

func getProcessedForUpdate(ctx context.Context, tx *sql.Tx, vacancyID string) (string, bool, error) {
	var status string
	err := tx.QueryRowContext(ctx, `
		SELECT status
		FROM processed_vacancies
		WHERE vacancy_id = $1
		FOR UPDATE`,
		vacancyID,
	).Scan(&status)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return status, true, nil
}

func (s *Store) applyCounterDelta(
	ctx context.Context,
	tx *sql.Tx,
	runID string,
	oldCategory storage.ResultCategoryValue,
	newCategory storage.ResultCategoryValue,
) error {
	if oldCategory == newCategory {
		return nil
	}

	appliedDelta := categoryDelta(oldCategory, newCategory, storage.ResultCategoryApplied)
	skippedDelta := categoryDelta(oldCategory, newCategory, storage.ResultCategorySkipped)
	errorDelta := categoryDelta(oldCategory, newCategory, storage.ResultCategoryError)

	if _, err := tx.ExecContext(ctx, `
		UPDATE apply_runs
		SET applied_count = GREATEST(applied_count + $2, 0),
		    skipped_count = GREATEST(skipped_count + $3, 0),
		    error_count = GREATEST(error_count + $4, 0)
		WHERE id = $1`,
		runID,
		appliedDelta,
		skippedDelta,
		errorDelta,
	); err != nil {
		return err
	}

	today := s.today()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO daily_apply_stats (date)
		VALUES ($1)
		ON CONFLICT DO NOTHING`,
		today,
	); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE daily_apply_stats
		SET applied_count = GREATEST(applied_count + $2, 0),
		    skipped_count = GREATEST(skipped_count + $3, 0),
		    error_count = GREATEST(error_count + $4, 0)
		WHERE date = $1`,
		today,
		appliedDelta,
		skippedDelta,
		errorDelta,
	)
	return err
}

func (s *Store) activeRun(ctx context.Context) (*storage.Run, error) {
	run, err := scanRun(s.db.QueryRowContext(ctx, `
		SELECT id::text, status, search_url, settings_snapshot,
		       applied_count, skipped_count, error_count, stop_reason
		FROM apply_runs
		WHERE status IN ('running', 'paused_captcha', 'paused_unknown', 'paused_network')
		ORDER BY started_at DESC
		LIMIT 1`))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &run, nil
}

func (s *Store) today() time.Time {
	now := time.Now().In(s.location)
	return localDate(now, s.location)
}

func localDate(now time.Time, location *time.Location) time.Time {
	year, month, day := now.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, location)
}

func categoryDelta(oldCategory, newCategory, category storage.ResultCategoryValue) int {
	delta := 0
	if oldCategory == category {
		delta--
	}
	if newCategory == category {
		delta++
	}
	return delta
}

func inQuery(template string, values []string) (string, []any) {
	placeholders := make([]string, len(values))
	args := make([]any, len(values))
	for i, value := range values {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = value
	}
	return fmt.Sprintf(template, strings.Join(placeholders, ",")), args
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgerrcode.UniqueViolation
}

func rollback(tx *sql.Tx) {
	_ = tx.Rollback()
}

type notificationExecer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func (s *Store) enqueueDailyLimitReached(ctx context.Context, execer notificationExecer, run storage.Run) error {
	dateString := s.today().Format("2006-01-02")
	payload := map[string]any{
		"date":       dateString,
		"runId":      run.ID,
		"applied":    run.AppliedCount,
		"dailyLimit": run.SettingsSnapshot.DailyLimit,
	}
	return enqueueNotification(
		ctx,
		execer,
		storage.NotificationKindDailyLimitReached,
		payload,
		fmt.Sprintf("%s:%s", storage.NotificationKindDailyLimitReached, dateString),
	)
}

func enqueueNotification(ctx context.Context, execer notificationExecer, kind storage.NotificationKind, payload any, dedupKey string) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	var dedup sql.NullString
	if dedupKey != "" {
		dedup = sql.NullString{String: dedupKey, Valid: true}
	}

	_, err = execer.ExecContext(ctx, `
		INSERT INTO notifications_outbox (kind, payload, dedup_key)
		VALUES ($1, $2, $3)
		ON CONFLICT (dedup_key) DO NOTHING`,
		string(kind),
		raw,
		dedup,
	)
	return err
}
