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
