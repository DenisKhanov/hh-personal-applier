package config_test

import (
	"strings"
	"testing"

	"hh-personal-applier/internal/config"
)

const validSecret = "12345678901234567890123456789012"

func setValidEnv(t *testing.T) {
	t.Helper()
	clearConfigEnv(t)
	t.Setenv("APP_PORT", "8080")
	t.Setenv("APP_BIND", "127.0.0.1")
	t.Setenv("APP_TIMEZONE", "Europe/Moscow")
	t.Setenv("LOCAL_SHARED_SECRET", validSecret)
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
}

func clearConfigEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"APP_PORT",
		"APP_BIND",
		"APP_TIMEZONE",
		"LOCAL_SHARED_SECRET",
		"DATABASE_DSN",
		"TELEGRAM_BOT_TOKEN",
		"TELEGRAM_OWNER_CHAT_ID",
		"LLM_PROVIDER",
		"LLM_API_KEY",
		"LLM_MODEL",
		"DEFAULT_DAILY_LIMIT",
		"DEFAULT_RUN_LIMIT",
		"MAX_DAILY_LIMIT",
		"MAX_RUN_LIMIT",
		"DEFAULT_PACE_MIN_SECONDS",
		"DEFAULT_PACE_MAX_SECONDS",
		"COVER_LETTER_TTL_HOURS",
	} {
		t.Setenv(key, "")
	}
}

func TestLoadValidConfig(t *testing.T) {
	setValidEnv(t)

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if cfg.Addr != "127.0.0.1:8080" {
		t.Errorf("expected addr 127.0.0.1:8080, got %s", cfg.Addr)
	}
	if cfg.Timezone.String() != "Europe/Moscow" {
		t.Errorf("expected Europe/Moscow timezone, got %s", cfg.Timezone)
	}
	if cfg.TelegramOwnerChatID != 123456 {
		t.Errorf("expected owner chat id 123456, got %d", cfg.TelegramOwnerChatID)
	}
}

func TestLoadNonLoopbackBindFails(t *testing.T) {
	setValidEnv(t)
	t.Setenv("APP_BIND", "0.0.0.0")

	_, err := config.Load()
	if err == nil {
		t.Fatal("expected error for non-loopback bind, got nil")
	}
	if !strings.Contains(err.Error(), "APP_BIND must be 127.0.0.1") {
		t.Fatalf("expected strict bind error, got %v", err)
	}
}

func TestLoadIPv6LoopbackBindFails(t *testing.T) {
	setValidEnv(t)
	t.Setenv("APP_BIND", "::1")

	_, err := config.Load()
	if err == nil {
		t.Fatal("expected error for IPv6 loopback bind, got nil")
	}
	if !strings.Contains(err.Error(), "APP_BIND must be 127.0.0.1") {
		t.Fatalf("expected strict bind error, got %v", err)
	}
}

func TestLoadNonDefaultPortFails(t *testing.T) {
	setValidEnv(t)
	t.Setenv("APP_PORT", "8081")

	_, err := config.Load()
	if err == nil {
		t.Fatal("expected error for non-default port, got nil")
	}
}

func TestLoadShortSecretFails(t *testing.T) {
	setValidEnv(t)
	t.Setenv("LOCAL_SHARED_SECRET", "tooshort")

	_, err := config.Load()
	if err == nil {
		t.Fatal("expected error for short secret, got nil")
	}
}

func TestLoadInvalidPacingFails(t *testing.T) {
	setValidEnv(t)
	t.Setenv("DEFAULT_PACE_MIN_SECONDS", "15")
	t.Setenv("DEFAULT_PACE_MAX_SECONDS", "10")

	_, err := config.Load()
	if err == nil {
		t.Fatal("expected error for invalid pacing, got nil")
	}
}

func TestLoadAllowsNonGroqLLMProvider(t *testing.T) {
	setValidEnv(t)
	t.Setenv("LLM_PROVIDER", "mock")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("expected non-groq provider to pass config validation, got %v", err)
	}
	if cfg.LLMProvider != "mock" {
		t.Fatalf("expected provider mock, got %q", cfg.LLMProvider)
	}
}

func TestLoadMissingRequiredFails(t *testing.T) {
	clearConfigEnv(t)

	_, err := config.Load()
	if err == nil {
		t.Fatal("expected error for missing required fields, got nil")
	}
	if !strings.Contains(err.Error(), "LOCAL_SHARED_SECRET") {
		t.Fatalf("expected missing secret error, got %v", err)
	}
}
