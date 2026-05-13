package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"hh-personal-applier/internal/api"
	"hh-personal-applier/internal/config"
	"hh-personal-applier/internal/coverletter"
	"hh-personal-applier/internal/db"
	"hh-personal-applier/internal/llm"
	"hh-personal-applier/internal/logging"
	postgresstore "hh-personal-applier/internal/storage/postgres"
	"hh-personal-applier/internal/telegram"
	"hh-personal-applier/migrations"
)

func main() {
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

	if err := db.RunMigrations(cfg.DatabaseDSN, migrations.FS); err != nil {
		slog.Error("migrations failed", "err", err)
		os.Exit(1)
	}
	slog.Info("migrations applied")

	store := postgresstore.New(database, cfg.Timezone)
	if cfg.LLMProvider != "groq" {
		slog.Error("unsupported LLM provider", "provider", cfg.LLMProvider)
		os.Exit(1)
	}
	llmProvider := llm.NewGroqProvider(llm.GroqConfig{
		APIKey: cfg.LLMAPIKey,
		Model:  cfg.LLMModel,
	})
	coverLetterService := coverletter.NewService(store, llmProvider, coverletter.Config{
		TTL:         time.Duration(cfg.CoverLetterTTLHours) * time.Hour,
		MaxAttempts: 3,
	})

	telegramClient, err := telegram.NewTelebotClient(cfg.TelegramBotToken, cfg.TelegramOwnerChatID)
	if err != nil {
		slog.Error("telegram client init failed", "err", err)
		os.Exit(1)
	}
	telegramClient.RegisterCoverLetterCallbacks(coverLetterService)

	runtimeCtx, stopRuntime := context.WithCancel(context.Background())
	defer stopRuntime()

	dispatcher := telegram.NewDispatcher(store, telegramClient, telegram.DispatcherConfig{
		Interval: 5 * time.Second,
	})
	go dispatcher.Run(runtimeCtx)
	go telegramClient.Run(runtimeCtx)

	dailyReporter := telegram.NewDailyReporter(store, cfg.Timezone, telegram.DailyReporterConfig{
		Interval: time.Minute,
	})
	go dailyReporter.Run(runtimeCtx)

	server := &http.Server{
		Addr:         cfg.Addr,
		Handler:      api.NewRouterWithCoverLetters(cfg.SharedSecret, store, coverLetterService),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("server starting", "addr", cfg.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrors <- err
			return
		}
		serverErrors <- nil
	}()

	shutdownSignals := make(chan os.Signal, 1)
	signal.Notify(shutdownSignals, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		if err != nil {
			stopRuntime()
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	case sig := <-shutdownSignals:
		slog.Info("shutdown signal received", "signal", sig.String())
	}

	stopRuntime()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		slog.Error("shutdown error", "err", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}
