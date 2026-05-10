CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE processed_vacancies (
    vacancy_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN (
        'attempting', 'applied', 'skipped', 'skipped_test', 'skipped_external',
        'skipped_archived', 'skipped_already_applied', 'skipped_cover_letter',
        'manual_action', 'unknown_after_click', 'error'
    )),
    vacancy_title TEXT,
    employer_name TEXT,
    vacancy_url TEXT,
    notes TEXT,
    attempt_started_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_apply_stats (
    date DATE PRIMARY KEY,
    applied_count INT NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
    skipped_count INT NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
    error_count INT NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    captcha_pause_count INT NOT NULL DEFAULT 0 CHECK (captcha_pause_count >= 0)
);

CREATE TABLE notifications_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN (
        'captcha', 'error', 'daily_limit_reached',
        'cover_letter_approval', 'daily_report', 'login_lost'
    )),
    payload JSONB NOT NULL,
    dedup_key TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cover_letters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vacancy_id TEXT NOT NULL,
    vacancy_title TEXT,
    body TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('ru', 'en')),
    status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
        'pending_approval', 'approved', 'skipped', 'expired'
    )),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vacancy_id)
);

CREATE TABLE owner_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    daily_limit INT NOT NULL DEFAULT 100 CHECK (daily_limit BETWEEN 1 AND 200),
    run_limit INT NOT NULL DEFAULT 25 CHECK (run_limit BETWEEN 1 AND 100),
    pace_min_seconds INT NOT NULL DEFAULT 6 CHECK (pace_min_seconds BETWEEN 5 AND 60),
    pace_max_seconds INT NOT NULL DEFAULT 14 CHECK (pace_max_seconds BETWEEN 5 AND 180),
    skip_with_test BOOLEAN NOT NULL DEFAULT TRUE,
    skip_external BOOLEAN NOT NULL DEFAULT TRUE,
    require_cover_letter_approval BOOLEAN NOT NULL DEFAULT TRUE,
    auto_apply BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (pace_min_seconds <= pace_max_seconds)
);

CREATE TABLE apply_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
        'running', 'paused_captcha', 'paused_unknown',
        'paused_network', 'stopped', 'completed'
    )),
    search_url TEXT NOT NULL,
    settings_snapshot JSONB NOT NULL,
    applied_count INT NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
    skipped_count INT NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
    error_count INT NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    stop_reason TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at TIMESTAMPTZ
);

INSERT INTO owner_settings DEFAULT VALUES ON CONFLICT DO NOTHING;
