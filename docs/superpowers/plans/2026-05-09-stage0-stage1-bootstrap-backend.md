# Этап 0 + Этап 1: Bootstrap + Backend Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Создать структуру репозитория и рабочий Go-бэкенд с health endpoint, шестью Postgres-миграциями, валидацией конфига (включая loopback-проверку bind-адреса) и middleware проверки `X-Local-Secret`.

**Execution status (2026-05-10):** Этапы 0 и 1 выполнены и отражены в
`Pipeline_razrabotki_browser_extension.md`. Текущий следующий шаг по pipeline:
закрыть оставшийся manual smoke Этапа 2
(`Developer mode` install + popup health-check), затем переходить к Этапу 3
Backend ↔ Extension API.

**Architecture:** Монорепо: `extension/` и `backend/` в корне. Backend — `cmd/server/main.go` → huma/v2 router → handlers в `internal/api/`. Конфиг читается из env-переменных (`.env` загружается через godotenv в dev). Postgres через `pgx/v5/stdlib` + `database/sql`; миграции через `golang-migrate/v4` с `iofs` source и pgx/v5 database driver. Graceful shutdown на `SIGINT`/`SIGTERM`.

**Tech Stack:** Go 1.23+, `huma/v2`, `pgx/v5`, `golang-migrate/v4`, `joho/godotenv`, `slog`, Docker Compose (Postgres 16-alpine)

---

## Карта файлов

```
hh-personal-applier/
├─ .gitignore                                    CREATE
├─ docker-compose.yml                            CREATE
├─ .env.example                                  CREATE
├─ Makefile                                      CREATE
│
└─ backend/
   ├─ go.mod                                     CREATE
   ├─ go.sum                                     (go mod tidy)
   ├─ cmd/server/main.go                         CREATE
   ├─ migrations/
   │  ├─ embed.go                                CREATE
   │  ├─ 000001_initial.up.sql                   CREATE
   │  └─ 000001_initial.down.sql                 CREATE
   └─ internal/
      ├─ config/
      │  ├─ config.go                            CREATE
      │  └─ config_test.go                       CREATE
      ├─ logging/
      │  └─ logging.go                           CREATE
      ├─ db/
      │  └─ db.go                                CREATE
      └─ api/
         ├─ router.go                            CREATE
         ├─ middleware.go                         CREATE
         ├─ middleware_test.go                    CREATE
         ├─ health.go                            CREATE
         └─ health_test.go                       CREATE
```

---

## Task 0.1: Репозиторий — структура, gitignore, docker-compose, .env.example

**Files:**
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `Makefile`
- Create dirs: `extension/src/`, `backend/`, `docs/selectors.md`, `docs/runbook.md`

- [x] **Создать .gitignore**

```
node_modules/
extension/dist/
backend/bin/
.env
*.log
```

- [x] **Создать docker-compose.yml**

```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: hh_personal
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

- [x] **Создать .env.example**

```dotenv
APP_PORT=8080
APP_BIND=127.0.0.1
APP_TIMEZONE=Europe/Moscow
LOCAL_SHARED_SECRET=<generate: openssl rand -base64 32>

DATABASE_DSN=postgres://postgres:postgres@127.0.0.1:5432/hh_personal?sslmode=disable

TELEGRAM_BOT_TOKEN=<token from @BotFather>
TELEGRAM_OWNER_CHAT_ID=<your numeric chat id>

LLM_PROVIDER=groq
LLM_API_KEY=<groq api key>
LLM_MODEL=llama-3.3-70b-versatile

DEFAULT_DAILY_LIMIT=100
DEFAULT_RUN_LIMIT=25
MAX_DAILY_LIMIT=200
MAX_RUN_LIMIT=100
DEFAULT_PACE_MIN_SECONDS=6
DEFAULT_PACE_MAX_SECONDS=14
COVER_LETTER_TTL_HOURS=1
```

- [x] **Создать Makefile**

```makefile
.PHONY: up down backend test

up:
	docker compose up -d
	@echo "Postgres running on 127.0.0.1:5432"

down:
	docker compose down

backend:
	cd backend && go run ./cmd/server

test:
	cd backend && go test ./...
```

- [x] **Создать заглушки директорий и пустые placeholder-файлы**

```bash
mkdir -p extension/src backend/cmd/server backend/internal/config \
         backend/internal/logging backend/internal/db \
         backend/internal/api backend/migrations \
         docs
touch docs/selectors.md docs/runbook.md
```

- [x] **Инициализировать git и создать первый коммит**

```bash
git init
git add .gitignore docker-compose.yml .env.example Makefile docs/
git commit -m "chore: project bootstrap — repo structure, docker-compose, env example"
```

Ожидаемый вывод: `[main (root-commit) xxxxxxx] chore: project bootstrap`

---

## Task 1.1: go.mod — инициализация модуля и зависимости

**Files:**
- Create: `backend/go.mod`

- [x] **Инициализировать Go-модуль**

```bash
cd backend && go mod init hh-personal-applier
```

- [x] **Добавить зависимости**

```bash
go get github.com/danielgtaylor/huma/v2@latest
go get github.com/jackc/pgx/v5@latest
go get github.com/golang-migrate/migrate/v4@latest
go get github.com/golang-migrate/migrate/v4/database/pgx/v5@latest
go get github.com/joho/godotenv@latest
go mod tidy
```

- [x] **Убедиться, что go.mod содержит все пять зависимостей**

```bash
grep -E "huma|pgx|migrate|godotenv" go.mod
```

Ожидаемый вывод — 5 строк с указанными пакетами.

- [x] **Commit**

```bash
git add backend/go.mod backend/go.sum
git commit -m "chore(backend): initialize go module with dependencies"
```

---

## Task 1.2: internal/config — загрузка и валидация env

**Files:**
- Create: `backend/internal/config/config.go`
- Create: `backend/internal/config/config_test.go`

- [x] **Написать провальный тест (TDD — red)**

`backend/internal/config/config_test.go`:

```go
package config_test

import (
	"testing"

	"hh-personal-applier/internal/config"
)

func TestLoad_ValidConfig(t *testing.T) {
	t.Setenv("APP_PORT", "8080")
	t.Setenv("APP_BIND", "127.0.0.1")
	t.Setenv("APP_TIMEZONE", "Europe/Moscow")
	t.Setenv("LOCAL_SHARED_SECRET", "12345678901234567890123456789012") // 32 chars
	t.Setenv("DATABASE_DSN", "postgres://localhost/test")
	t.Setenv("TELEGRAM_BOT_TOKEN", "token")
	t.Setenv("TELEGRAM_OWNER_CHAT_ID", "123456")
	t.Setenv("LLM_PROVIDER", "groq")
	t.Setenv("LLM_API_KEY", "key")
	t.Setenv("LLM_MODEL", "llama-3.3-70b-versatile")
	t.Setenv("DEFAULT_DAILY_LIMIT", "100")
	t.Setenv("DEFAULT_RUN_LIMIT", "25")
	t.Setenv("MAX_DAILY_LIMIT", "200")
	t.Setenv("MAX_RUN_LIMIT", "100")
	t.Setenv("DEFAULT_PACE_MIN_SECONDS", "6")
	t.Setenv("DEFAULT_PACE_MAX_SECONDS", "14")
	t.Setenv("COVER_LETTER_TTL_HOURS", "1")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.Addr != "127.0.0.1:8080" {
		t.Errorf("expected addr 127.0.0.1:8080, got %s", cfg.Addr)
	}
}

func TestLoad_NonLoopbackBind_Fails(t *testing.T) {
	t.Setenv("APP_BIND", "0.0.0.0")
	t.Setenv("APP_PORT", "8080")
	t.Setenv("LOCAL_SHARED_SECRET", "12345678901234567890123456789012")
	t.Setenv("DATABASE_DSN", "postgres://localhost/test")
	t.Setenv("TELEGRAM_BOT_TOKEN", "tok")
	t.Setenv("TELEGRAM_OWNER_CHAT_ID", "1")
	t.Setenv("LLM_PROVIDER", "groq")
	t.Setenv("LLM_API_KEY", "k")
	t.Setenv("LLM_MODEL", "m")

	_, err := config.Load()
	if err == nil {
		t.Fatal("expected error for non-loopback bind, got nil")
	}
}

func TestLoad_ShortSecret_Fails(t *testing.T) {
	t.Setenv("APP_BIND", "127.0.0.1")
	t.Setenv("APP_PORT", "8080")
	t.Setenv("LOCAL_SHARED_SECRET", "tooshort") // < 32 chars
	t.Setenv("DATABASE_DSN", "postgres://localhost/test")
	t.Setenv("TELEGRAM_BOT_TOKEN", "tok")
	t.Setenv("TELEGRAM_OWNER_CHAT_ID", "1")
	t.Setenv("LLM_PROVIDER", "groq")
	t.Setenv("LLM_API_KEY", "k")
	t.Setenv("LLM_MODEL", "m")

	_, err := config.Load()
	if err == nil {
		t.Fatal("expected error for short secret, got nil")
	}
}

func TestLoad_MissingRequired_Fails(t *testing.T) {
	// No env vars set at all
	_, err := config.Load()
	if err == nil {
		t.Fatal("expected error for missing required fields, got nil")
	}
}
```

- [x] **Запустить тест — убедиться, что падает (red)**

```bash
cd backend && go test ./internal/config/... -v
```

Ожидаемый вывод: `cannot find package` или `undefined: config.Load`.

- [x] **Реализовать config.go**

`backend/internal/config/config.go`:

```go
package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Addr     string // Bind:Port
	Timezone *time.Location

	SharedSecret string

	DatabaseDSN string

	TelegramBotToken    string
	TelegramOwnerChatID int64

	LLMProvider string
	LLMAPIKey   string
	LLMModel    string

	DefaultDailyLimit    int
	DefaultRunLimit      int
	MaxDailyLimit        int
	MaxRunLimit          int
	DefaultPaceMinSeconds int
	DefaultPaceMaxSeconds int
	CoverLetterTTLHours  int
}

func Load() (*Config, error) {
	bind := getEnv("APP_BIND", "127.0.0.1")
	port := getEnv("APP_PORT", "8080")

	ip := net.ParseIP(bind)
	if ip == nil || !ip.IsLoopback() {
		return nil, fmt.Errorf("config: APP_BIND must be a loopback address, got %q", bind)
	}

	secret := os.Getenv("LOCAL_SHARED_SECRET")
	if len(secret) < 32 {
		return nil, fmt.Errorf("config: LOCAL_SHARED_SECRET must be at least 32 characters")
	}

	dsn := os.Getenv("DATABASE_DSN")
	if dsn == "" {
		return nil, fmt.Errorf("config: DATABASE_DSN is required")
	}

	tgToken := os.Getenv("TELEGRAM_BOT_TOKEN")
	if tgToken == "" {
		return nil, fmt.Errorf("config: TELEGRAM_BOT_TOKEN is required")
	}

	tgChatIDStr := os.Getenv("TELEGRAM_OWNER_CHAT_ID")
	if tgChatIDStr == "" {
		return nil, fmt.Errorf("config: TELEGRAM_OWNER_CHAT_ID is required")
	}
	tgChatID, err := strconv.ParseInt(tgChatIDStr, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("config: TELEGRAM_OWNER_CHAT_ID must be an integer: %w", err)
	}

	llmProvider := os.Getenv("LLM_PROVIDER")
	if llmProvider == "" {
		return nil, fmt.Errorf("config: LLM_PROVIDER is required")
	}
	llmKey := os.Getenv("LLM_API_KEY")
	if llmKey == "" {
		return nil, fmt.Errorf("config: LLM_API_KEY is required")
	}
	llmModel := os.Getenv("LLM_MODEL")
	if llmModel == "" {
		return nil, fmt.Errorf("config: LLM_MODEL is required")
	}

	tzName := getEnv("APP_TIMEZONE", "Europe/Moscow")
	tz, err := time.LoadLocation(tzName)
	if err != nil {
		return nil, fmt.Errorf("config: invalid APP_TIMEZONE %q: %w", tzName, err)
	}

	cfg := &Config{
		Addr:                bind + ":" + port,
		Timezone:            tz,
		SharedSecret:        secret,
		DatabaseDSN:         dsn,
		TelegramBotToken:    tgToken,
		TelegramOwnerChatID: tgChatID,
		LLMProvider:         llmProvider,
		LLMAPIKey:           llmKey,
		LLMModel:            llmModel,
		DefaultDailyLimit:   mustInt("DEFAULT_DAILY_LIMIT", 100),
		DefaultRunLimit:     mustInt("DEFAULT_RUN_LIMIT", 25),
		MaxDailyLimit:       mustInt("MAX_DAILY_LIMIT", 200),
		MaxRunLimit:         mustInt("MAX_RUN_LIMIT", 100),
		DefaultPaceMinSeconds: mustInt("DEFAULT_PACE_MIN_SECONDS", 6),
		DefaultPaceMaxSeconds: mustInt("DEFAULT_PACE_MAX_SECONDS", 14),
		CoverLetterTTLHours:   mustInt("COVER_LETTER_TTL_HOURS", 1),
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
```

- [x] **Запустить тесты — убедиться, что проходят (green)**

```bash
cd backend && go test ./internal/config/... -v
```

Ожидаемый вывод: `PASS` для всех 4 тестов, `ok hh-personal-applier/internal/config`.

- [x] **Commit**

```bash
git add backend/internal/config/
git commit -m "feat(backend): config loading with loopback bind and secret length validation"
```

---

## Task 1.3: internal/logging — slog JSON setup

**Files:**
- Create: `backend/internal/logging/logging.go`

- [x] **Написать logging.go**

```go
package logging

import (
	"log/slog"
	"os"
)

// Setup configures the global slog logger. Call once at startup before any logging.
func Setup(debug bool) {
	level := slog.LevelInfo
	if debug {
		level = slog.LevelDebug
	}
	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	slog.SetDefault(slog.New(h))
}
```

- [x] **Проверить компиляцию**

```bash
cd backend && go build ./internal/logging/...
```

Ожидаемый вывод: пустой (нет ошибок).

- [x] **Commit**

```bash
git add backend/internal/logging/
git commit -m "feat(backend): structured JSON logging via slog"
```

---

## Task 1.4: Миграции — SQL + embed

**Files:**
- Create: `backend/migrations/embed.go`
- Create: `backend/migrations/000001_initial.up.sql`
- Create: `backend/migrations/000001_initial.down.sql`

- [x] **Создать backend/migrations/embed.go**

```go
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
```

- [x] **Создать backend/migrations/000001_initial.up.sql**

```sql
CREATE TABLE processed_vacancies (
    vacancy_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN (
        'attempting', 'applied', 'skipped_test', 'skipped_external',
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

-- Seed default owner settings row
INSERT INTO owner_settings DEFAULT VALUES ON CONFLICT DO NOTHING;
```

- [x] **Создать backend/migrations/000001_initial.down.sql**

```sql
DROP TABLE IF EXISTS apply_runs;
DROP TABLE IF EXISTS owner_settings;
DROP TABLE IF EXISTS cover_letters;
DROP TABLE IF EXISTS notifications_outbox;
DROP TABLE IF EXISTS daily_apply_stats;
DROP TABLE IF EXISTS processed_vacancies;
```

- [x] **Проверить компиляцию embed**

```bash
cd backend && go build ./migrations/...
```

Ожидаемый вывод: пустой.

- [x] **Commit**

```bash
git add backend/migrations/
git commit -m "feat(backend): all 6 DB migrations with embed — processed_vacancies, daily_apply_stats, notifications_outbox, cover_letters, owner_settings, apply_runs"
```

---

## Task 1.5: internal/db — Postgres connect + run migrations

**Files:**
- Create: `backend/internal/db/db.go`

- [x] **Написать db.go**

```go
package db

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"

	"github.com/golang-migrate/migrate/v4"
	pgxmigrate "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Connect opens a *sql.DB using the pgx driver and verifies connectivity.
func Connect(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("db open: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("db ping: %w", err)
	}
	return db, nil
}

// RunMigrations applies all pending up-migrations from migrationsFS.
func RunMigrations(db *sql.DB, migrationsFS fs.FS) error {
	src, err := iofs.New(migrationsFS, ".")
	if err != nil {
		return fmt.Errorf("migration source: %w", err)
	}
	driver, err := pgxmigrate.WithInstance(db, &pgxmigrate.Config{})
	if err != nil {
		return fmt.Errorf("migration driver: %w", err)
	}
	m, err := migrate.NewWithInstance("iofs", src, "pgx5", driver)
	if err != nil {
		return fmt.Errorf("migrator init: %w", err)
	}
	defer func() {
		srcErr, dbErr := m.Close()
		if srcErr != nil {
			slog.Error("migration source close", "err", srcErr)
		}
		if dbErr != nil {
			slog.Error("migration db close", "err", dbErr)
		}
	}()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}
```

- [x] **Проверить компиляцию**

```bash
cd backend && go build ./internal/db/...
```

Ожидаемый вывод: пустой.

- [x] **Commit**

```bash
git add backend/internal/db/
git commit -m "feat(backend): postgres connect + golang-migrate up via pgx/v5"
```

---

## Task 1.6: internal/api/middleware — X-Local-Secret

**Files:**
- Create: `backend/internal/api/middleware.go`
- Create: `backend/internal/api/middleware_test.go`

- [x] **Написать провальный тест (red)**

`backend/internal/api/middleware_test.go`:

```go
package api_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"hh-personal-applier/internal/api"
)

const testSecret = "12345678901234567890123456789012"

func okHandler(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func TestSecretMiddleware_MissingHeader_Returns401(t *testing.T) {
	handler := api.SecretMiddleware(testSecret)(http.HandlerFunc(okHandler))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestSecretMiddleware_WrongHeader_Returns401(t *testing.T) {
	handler := api.SecretMiddleware(testSecret)(http.HandlerFunc(okHandler))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-Local-Secret", "wrong-secret")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestSecretMiddleware_CorrectHeader_Passes(t *testing.T) {
	handler := api.SecretMiddleware(testSecret)(http.HandlerFunc(okHandler))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-Local-Secret", testSecret)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}
```

- [x] **Запустить тест — убедиться, что падает (red)**

```bash
cd backend && go test ./internal/api/... -v -run TestSecretMiddleware
```

Ожидаемый вывод: `undefined: api.SecretMiddleware`.

- [x] **Написать middleware.go**

`backend/internal/api/middleware.go`:

```go
package api

import (
	"net/http"
)

// SecretMiddleware rejects requests that don't carry the correct X-Local-Secret header.
func SecretMiddleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Local-Secret") != secret {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"invalid or missing X-Local-Secret"}}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

- [x] **Запустить тесты — убедиться, что проходят (green)**

```bash
cd backend && go test ./internal/api/... -v -run TestSecretMiddleware
```

Ожидаемый вывод: 3 теста `PASS`.

- [x] **Commit**

```bash
git add backend/internal/api/middleware.go backend/internal/api/middleware_test.go
git commit -m "feat(backend): X-Local-Secret auth middleware with tests"
```

---

## Task 1.7: internal/api/health + router — GET /health

**Files:**
- Create: `backend/internal/api/health.go`
- Create: `backend/internal/api/health_test.go`
- Create: `backend/internal/api/router.go`

- [x] **Написать провальный тест (red)**

`backend/internal/api/health_test.go`:

```go
package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"hh-personal-applier/internal/api"
)

func TestHealth_WithSecret_Returns200(t *testing.T) {
	mux := api.NewRouter(testSecret)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-Local-Secret", testSecret)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("expected status ok, got %q", body.Status)
	}
}

func TestHealth_WithoutSecret_Returns401(t *testing.T) {
	mux := api.NewRouter(testSecret)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}
```

- [x] **Запустить тест — убедиться, что падает (red)**

```bash
cd backend && go test ./internal/api/... -v -run TestHealth
```

Ожидаемый вывод: `undefined: api.NewRouter`.

- [x] **Написать health.go**

`backend/internal/api/health.go`:

```go
package api

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

type healthOutput struct {
	Body struct {
		Status string `json:"status"`
	}
}

func registerHealth(a huma.API) {
	huma.Register(a, huma.Operation{
		OperationID: "get-health",
		Method:      http.MethodGet,
		Path:        "/health",
		Summary:     "Health check",
		Tags:        []string{"system"},
	}, func(_ context.Context, _ *struct{}) (*healthOutput, error) {
		out := &healthOutput{}
		out.Body.Status = "ok"
		return out, nil
	})
}
```

- [x] **Написать router.go**

`backend/internal/api/router.go`:

```go
package api

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/humago"
)

// NewRouter builds and returns the HTTP handler with all routes registered
// and the secret middleware applied.
func NewRouter(secret string) http.Handler {
	mux := http.NewServeMux()
	cfg := huma.DefaultConfig("HH Personal Applier", "0.1.0")
	cfg.DocsPath = "" // disable OpenAPI UI in production
	a := humago.New(mux, cfg)

	registerHealth(a)

	return SecretMiddleware(secret)(mux)
}
```

- [x] **Запустить тесты — убедиться, что проходят (green)**

```bash
cd backend && go test ./internal/api/... -v
```

Ожидаемый вывод: все 5 тестов (3 middleware + 2 health) `PASS`.

- [x] **Commit**

```bash
git add backend/internal/api/
git commit -m "feat(backend): GET /health endpoint via huma/v2 with secret middleware"
```

---

## Task 1.8: cmd/server/main.go — wire-up + graceful shutdown

**Files:**
- Create: `backend/cmd/server/main.go`

- [x] **Написать main.go**

```go
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"hh-personal-applier/internal/api"
	"hh-personal-applier/internal/config"
	"hh-personal-applier/internal/db"
	"hh-personal-applier/internal/logging"
	"hh-personal-applier/migrations"
)

func main() {
	// Load .env if present (dev convenience; production uses real env vars)
	_ = godotenv.Load()

	logging.Setup(os.Getenv("APP_DEBUG") == "true")

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}

	database, err := db.Connect(cfg.DatabaseDSN)
	if err != nil {
		slog.Error("db connect failed", "err", err)
		os.Exit(1)
	}
	defer database.Close()

	if err := db.RunMigrations(database, migrations.FS); err != nil {
		slog.Error("migrations failed", "err", err)
		os.Exit(1)
	}
	slog.Info("migrations applied")

	router := api.NewRouter(cfg.SharedSecret)

	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("server starting", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("shutdown error", "err", err)
	}
	slog.Info("server stopped")
}
```

- [x] **Проверить компиляцию**

```bash
cd backend && go build ./cmd/server/
```

Ожидаемый вывод: пустой (создаётся бинарь `server` в backend/).

- [x] **Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "feat(backend): main.go with graceful shutdown, config + db + migrations wired"
```

---

## Task 1.9: Smoke verification — запуск и проверка

**Цель:** убедиться, что сервер стартует, миграции применяются, `/health` отвечает `200`.

- [x] **Запустить Postgres**

```bash
docker compose up -d
docker compose ps
```

Ожидаемый вывод: `postgres ... healthy`.

- [x] **Создать .env из примера и заполнить**

```bash
cp .env.example .env
```

Отредактировать `.env`: задать `LOCAL_SHARED_SECRET` (минимум 32 символа, можно `openssl rand -base64 32`). Остальные поля Telegram/LLM можно оставить заглушками для smoke — они не нужны для health endpoint.

- [x] **Запустить сервер**

```bash
make backend
```

Ожидаемый вывод в stdout:
```json
{"time":"...","level":"INFO","msg":"migrations applied"}
{"time":"...","level":"INFO","msg":"server starting","addr":"127.0.0.1:8080"}
```

- [x] **Проверить GET /health**

В новом терминале:
```bash
SECRET=$(grep LOCAL_SHARED_SECRET .env | cut -d= -f2)
curl -s -H "X-Local-Secret: $SECRET" http://127.0.0.1:8080/health | python3 -m json.tool
```

Ожидаемый вывод:
```json
{
    "status": "ok"
}
```

- [x] **Проверить что без секрета — 401**

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/health
```

Ожидаемый вывод: `401`.

- [x] **Запустить все тесты**

```bash
cd backend && go test ./... -v
```

Ожидаемый вывод: `ok` для всех пакетов, 0 failures.

- [x] **go vet**

```bash
cd backend && go vet ./...
```

Ожидаемый вывод: пустой.

- [x] **Финальный коммит Этапа 1**

```bash
git add .
git commit -m "feat: stage 1 complete — backend skeleton with health endpoint, migrations, config validation"
```

---

## Self-Review

### Spec coverage

| Требование из Pipeline §12 Этап 0+1 | Покрыто |
|---|---|
| `.gitignore` (node_modules, dist, bin, .env, *.log) | ✅ Task 0.1 |
| `docker-compose.yml` только с Postgres | ✅ Task 0.1 |
| `.env.example` | ✅ Task 0.1 |
| `go.mod` + `cmd/server/main.go` | ✅ Task 1.1, 1.8 |
| `internal/config` — загрузка и валидация env | ✅ Task 1.2 |
| Loopback-only bind validation | ✅ Task 1.2 |
| `LOCAL_SHARED_SECRET` >= 32 символов | ✅ Task 1.2 |
| `APP_TIMEZONE` | ✅ Task 1.2 |
| `DEFAULT_*/MAX_*` лимиты из env | ✅ Task 1.2 |
| `internal/logging` — slog адаптер | ✅ Task 1.3 |
| Postgres connection | ✅ Task 1.5 |
| Миграции: все 6 таблиц | ✅ Task 1.4 |
| `skipped_cover_letter` в status enum | ✅ Task 1.4 |
| `dedup_key` в notifications_outbox | ✅ Task 1.4 |
| `settings_snapshot JSONB` в apply_runs | ✅ Task 1.4 |
| Seed `owner_settings` ON CONFLICT DO NOTHING | ✅ Task 1.4 |
| Middleware `X-Local-Secret` → 401 без заголовка | ✅ Task 1.6 |
| `GET /health` → 200 | ✅ Task 1.7 |
| Graceful shutdown SIGINT/SIGTERM | ✅ Task 1.8 |
| Listen строго `127.0.0.1` | ✅ Task 1.2 (валидация) + Task 1.8 |

### Placeholder scan

Нет TBD, нет "implement later", весь код прописан полностью.

### Type consistency

- `Config.Addr` используется в Task 1.2 и Task 1.8 ✅
- `api.NewRouter(secret)` определён в Task 1.7 и используется в Task 1.8 ✅
- `db.Connect`, `db.RunMigrations` определены в Task 1.5, используются в Task 1.8 ✅
- `migrations.FS` определён в Task 1.4, используется в Task 1.8 ✅
- `api.SecretMiddleware` определён в Task 1.6, используется в middleware_test.go (Task 1.6) и router.go (Task 1.7) ✅

---

**План сохранён в `docs/superpowers/plans/2026-05-09-stage0-stage1-bootstrap-backend.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — свежий субагент на каждый task, проверка между ними, быстрая итерация.

**2. Inline Execution** — выполнение в этой сессии через `superpowers:executing-plans` с чекпойнтами.

**Какой подход выбираешь?**
