package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

const (
	requiredBind = "127.0.0.1"
	requiredPort = "8080"
)

type Config struct {
	Addr     string
	Timezone *time.Location

	SharedSecret string

	DatabaseDSN string

	TelegramBotToken    string
	TelegramOwnerChatID int64

	LLMProvider string
	LLMAPIKey   string
	LLMModel    string

	DefaultDailyLimit     int
	DefaultRunLimit       int
	MaxDailyLimit         int
	MaxRunLimit           int
	DefaultPaceMinSeconds int
	DefaultPaceMaxSeconds int
	CoverLetterTTLHours   int
}

func Load() (*Config, error) {
	bind := getEnv("APP_BIND", requiredBind)
	if bind != requiredBind {
		return nil, fmt.Errorf("config: APP_BIND must be %s, got %q", requiredBind, bind)
	}

	port := getEnv("APP_PORT", requiredPort)
	if port != requiredPort {
		return nil, fmt.Errorf("config: APP_PORT must be %s, got %q", requiredPort, port)
	}

	secret, err := required("LOCAL_SHARED_SECRET")
	if err != nil {
		return nil, err
	}
	if len(secret) < 32 {
		return nil, fmt.Errorf("config: LOCAL_SHARED_SECRET must be at least 32 characters")
	}

	dsn, err := required("DATABASE_DSN")
	if err != nil {
		return nil, err
	}

	tgToken, err := required("TELEGRAM_BOT_TOKEN")
	if err != nil {
		return nil, err
	}

	tgChatIDStr, err := required("TELEGRAM_OWNER_CHAT_ID")
	if err != nil {
		return nil, err
	}
	tgChatID, err := strconv.ParseInt(tgChatIDStr, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("config: TELEGRAM_OWNER_CHAT_ID must be an integer: %w", err)
	}

	llmProvider, err := required("LLM_PROVIDER")
	if err != nil {
		return nil, err
	}

	llmKey, err := required("LLM_API_KEY")
	if err != nil {
		return nil, err
	}

	llmModel, err := required("LLM_MODEL")
	if err != nil {
		return nil, err
	}

	tzName := getEnv("APP_TIMEZONE", "Europe/Moscow")
	tz, err := time.LoadLocation(tzName)
	if err != nil {
		return nil, fmt.Errorf("config: invalid APP_TIMEZONE %q: %w", tzName, err)
	}

	defaultDailyLimit, err := intEnv("DEFAULT_DAILY_LIMIT", 100)
	if err != nil {
		return nil, err
	}
	defaultRunLimit, err := intEnv("DEFAULT_RUN_LIMIT", 25)
	if err != nil {
		return nil, err
	}
	maxDailyLimit, err := intEnv("MAX_DAILY_LIMIT", 200)
	if err != nil {
		return nil, err
	}
	maxRunLimit, err := intEnv("MAX_RUN_LIMIT", 100)
	if err != nil {
		return nil, err
	}
	paceMin, err := intEnv("DEFAULT_PACE_MIN_SECONDS", 6)
	if err != nil {
		return nil, err
	}
	paceMax, err := intEnv("DEFAULT_PACE_MAX_SECONDS", 14)
	if err != nil {
		return nil, err
	}
	ttlHours, err := intEnv("COVER_LETTER_TTL_HOURS", 1)
	if err != nil {
		return nil, err
	}

	if defaultDailyLimit < 1 || maxDailyLimit < defaultDailyLimit || maxDailyLimit > 200 {
		return nil, fmt.Errorf("config: daily limits must satisfy 1 <= default <= max <= 200")
	}
	if defaultRunLimit < 1 || maxRunLimit < defaultRunLimit || maxRunLimit > 100 {
		return nil, fmt.Errorf("config: run limits must satisfy 1 <= default <= max <= 100")
	}
	if paceMin < 5 || paceMin > 60 || paceMax < 5 || paceMax > 180 || paceMin > paceMax {
		return nil, fmt.Errorf("config: pacing must satisfy 5 <= min <= max and max <= 180")
	}
	if ttlHours < 1 {
		return nil, fmt.Errorf("config: COVER_LETTER_TTL_HOURS must be positive")
	}

	return &Config{
		Addr:                  bind + ":" + port,
		Timezone:              tz,
		SharedSecret:          secret,
		DatabaseDSN:           dsn,
		TelegramBotToken:      tgToken,
		TelegramOwnerChatID:   tgChatID,
		LLMProvider:           llmProvider,
		LLMAPIKey:             llmKey,
		LLMModel:              llmModel,
		DefaultDailyLimit:     defaultDailyLimit,
		DefaultRunLimit:       defaultRunLimit,
		MaxDailyLimit:         maxDailyLimit,
		MaxRunLimit:           maxRunLimit,
		DefaultPaceMinSeconds: paceMin,
		DefaultPaceMaxSeconds: paceMax,
		CoverLetterTTLHours:   ttlHours,
	}, nil
}

func required(key string) (string, error) {
	value := os.Getenv(key)
	if value == "" {
		return "", fmt.Errorf("config: %s is required", key)
	}
	return value, nil
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func intEnv(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("config: %s must be an integer: %w", key, err)
	}
	return n, nil
}
