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
	"hh-personal-applier/internal/db"
	"hh-personal-applier/internal/logging"
	postgresstore "hh-personal-applier/internal/storage/postgres"
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

	server := &http.Server{
		Addr:         cfg.Addr,
		Handler:      api.NewRouter(cfg.SharedSecret, postgresstore.New(database, cfg.Timezone)),
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
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	case sig := <-shutdownSignals:
		slog.Info("shutdown signal received", "signal", sig.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		slog.Error("shutdown error", "err", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}
