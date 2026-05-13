# Stage 7 Acceptance Checklist

- Backend has an `internal/llm` provider interface plus a Groq HTTP adapter.
- Cover-letter prompt, language detection, and guard are covered by unit tests.
- `POST /cover_letters/request` generates and persists a letter with `pending_approval` or `approved` status based on run settings.
- `GET /cover_letters/{vacancy_id}` returns current status and expires stale pending approvals.
- Telegram `cover_letter_approval` notifications include the generated letter and inline approval buttons.
- Telegram callbacks from `TELEGRAM_OWNER_CHAT_ID` resolve the pending letter idempotently.
- Extension handles a required-letter modal by requesting a letter, polling approval, filling the textarea, and submitting only after approval.
- Extension records `skipped_cover_letter` on skipped/expired approval or LLM rate-limit fallback.
- Verification: `go fmt`, `go vet ./...`, `go test ./...`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
