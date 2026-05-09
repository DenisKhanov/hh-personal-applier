# HH Personal Applier

Личный Chrome MV3 extension + локальный Go backend для полуавтоматических откликов на вакансии на `hh.ru` в собственной залогиненной сессии владельца.

Проект находится на стадии проектирования/bootstrap. Главный источник истины по архитектуре, ограничениям и этапам реализации: [`Pipeline_razrabotki_browser_extension.md`](Pipeline_razrabotki_browser_extension.md).

## Что это

- Браузерный макрос поверх живого UI `hh.ru`, а не серверный бот и не парсер.
- Один пользователь, один аккаунт, один браузер.
- Extension запускается вручную из popup и работает последовательно в одной вкладке.
- Local backend хранит состояние, лимиты, статистику, Telegram outbox и LLM cover letters.
- Postgres используется локально через Docker Compose.
- Telegram нужен для уведомлений и approval сопроводительных писем.

## Что это не делает

- Не обходит CAPTCHA.
- Не использует anti-detection, fingerprint spoofing, headless Chrome, прокси или IP-ротацию.
- Не читает cookies и не работает с чужими аккаунтами.
- Не публикуется в Chrome Web Store и не предназначен для SaaS/redistribution.
- Не отправляет сопроводительные письма без явного owner approval, если approval включён.

## Планируемый стек

- Chrome Extension Manifest V3.
- TypeScript, `tsc`, `esbuild`.
- Vanilla popup HTML/CSS/TS без UI-фреймворков.
- Go 1.23+.
- `net/http` + `huma/v2`.
- PostgreSQL 16.
- `golang-migrate`.
- `pgx/v5`.
- `slog`.
- `gopkg.in/telebot.v3`.
- Groq для LLM cover letters.

## Архитектура

```text
Chrome profile
  Chrome Extension
    popup UI
    background service worker
    content scripts for hh.ru
  hh.ru pages
  http://127.0.0.1:8080

Local Go backend
  settings and limits
  idempotency and run state
  statistics
  Telegram outbox
  LLM cover letters

Postgres
Telegram
Groq
```

Backend обязан слушать только `127.0.0.1:8080`. Все запросы extension → backend проходят с `X-Local-Secret`.

## Ключевые настройки

Планируемые дефолты:

- `dailyLimit`: `100`
- `runLimit`: `25`
- `paceMinSeconds`: `6`
- `paceMaxSeconds`: `14`
- `requireCoverLetterApproval`: `true`
- `autoApply`: `false`

Источник истины для safety-настроек и счётчиков — backend + Postgres. `chrome.storage.local` хранит только bootstrap/UI cache.

## Этапы реализации

0. Bootstrap: структура проекта, `.gitignore`, `README.md`, `AGENTS.md`, Docker Compose, `.env.example`.
1. Backend skeleton: config, logging, Postgres, migrations, health, shared secret middleware.
2. Extension skeleton: MV3 manifest, build pipeline, popup health-check.
3. Backend ↔ Extension API.
4. Read-only content scripts для выдачи `hh.ru`.
5. Auto-apply без писем.
6. Telegram outbox.
7. LLM cover letters.
8. Popup polish, лимиты, dashboard, manual smoke.

Подробный Definition of Done для каждого этапа описан в pipeline.

## Разработка агентами

Перед изменениями нужно читать:

- [`Pipeline_razrabotki_browser_extension.md`](Pipeline_razrabotki_browser_extension.md)
- [`AGENTS.md`](AGENTS.md)
- [`CLAUDE.md`](CLAUDE.md)

Если документы конфликтуют, pipeline выигрывает. README — только обзор.

## Текущий статус

Репозиторий пока содержит проектную спецификацию и агентские правила. Рабочий extension/backend ещё не реализованы.
