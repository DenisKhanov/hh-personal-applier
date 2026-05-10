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

func RunMigrations(dsn string, migrationsFS fs.FS) error {
	database, err := Connect(dsn)
	if err != nil {
		return fmt.Errorf("migration db connect: %w", err)
	}
	defer database.Close()

	src, err := iofs.New(migrationsFS, ".")
	if err != nil {
		return fmt.Errorf("migration source: %w", err)
	}

	driver, err := pgxmigrate.WithInstance(database, &pgxmigrate.Config{})
	if err != nil {
		return fmt.Errorf("migration driver: %w", err)
	}

	migrator, err := migrate.NewWithInstance("iofs", src, "pgx5", driver)
	if err != nil {
		return fmt.Errorf("migrator init: %w", err)
	}
	defer func() {
		srcErr, dbErr := migrator.Close()
		if srcErr != nil {
			slog.Error("migration source close", "err", srcErr)
		}
		if dbErr != nil {
			slog.Error("migration db close", "err", dbErr)
		}
	}()

	if err := migrator.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}

	return nil
}
