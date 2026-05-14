# HH Personal Applier

Личный Chrome MV3 extension + локальный Go backend для полуавтоматических
откликов на вакансии на `hh.ru` в собственной залогиненной сессии владельца.

Проект работает как браузерный макрос поверх живого UI: расширение читает DOM
только активной вкладки `hh.ru`, backend хранит состояние и лимиты локально, а
Telegram используется для уведомлений и approval сопроводительных писем.

> Status: `0.1beta`. Минимально необходимый функционал stage 0-8 собран для
> ручного тестирования. Это не публичный продукт и не Chrome Web Store extension.
> Главный source of truth по архитектуре и ограничениям:
> [`Pipeline_razrabotki_browser_extension.md`](Pipeline_razrabotki_browser_extension.md).

## Скриншоты

Текущий popup управляет bootstrap-настройками, запуском цикла, лимитами,
статистикой за день, последними обработанными вакансиями и ручным
подтверждением отклика.

![Popup dashboard](docs/assets/popup-dashboard.png)

![Running popup dashboard](docs/assets/popup-running-dashboard.png)

![Owner confirmation in popup](docs/assets/popup-confirmation.png)

## Что уже есть

- Chrome MV3 extension с popup UI, background service worker и content scripts.
- Проверка локального backend по `http://127.0.0.1:8080/health`.
- Bootstrap-настройки extension: `localBackendUrl` и `X-Local-Secret`.
- Backend API для кандидатов, попыток отклика, результатов, статистики,
  настроек владельца, active run и Telegram test message.
- PostgreSQL migrations для idempotency, дневной статистики, owner settings,
  runs, Telegram outbox и cover letters.
- Двухфазная запись отклика: перед кликом vacancy фиксируется как
  `attempting`, после результата переводится в финальный статус.
- Content scripts для read-only parsing выдачи `hh.ru/search/vacancy*` и
  выполнения клика на странице вакансии.
- Safety stops: CAPTCHA, потеря логина, unknown modal, DOM mismatch и network
  retry failures.
- Popup Start / Stop / Continue, дневной лимит, лимит на запуск, pacing,
  ручное подтверждение каждого отклика при `autoApply=false`.
- Telegram outbox, ежедневный отчёт, уведомления и test message.
- LLM cover letters через Groq в backend с Telegram approval flow.

## Что проект принципиально не делает

- Не решает CAPTCHA и не пытается её обходить.
- Не использует headless Chrome, прокси, IP-ротацию, fingerprint spoofing или
  anti-detection приёмы.
- Не читает cookies и не работает с чужими аккаунтами.
- Не парсит `hh.ru` в фоне, не открывает параллельные вкладки и не ходит в HH
  из backend.
- Не отправляет сопроводительное письмо без явного approval владельца, если
  approval включён.
- Не является SaaS, multi-user системой или продуктом для распространения.

## Архитектура

```text
Chrome profile
  Chrome Extension (Manifest V3)
    popup UI
      Start / Stop / Continue
      settings and dashboard
      owner confirmation
    background service worker
      run orchestration
      pacing and retries
      backend API calls
    content scripts
      search DOM parser
      vacancy click executor
      anomaly detection

  hh.ru active tab
  http://127.0.0.1:8080

Local Go backend
  huma/v2 REST API
  config validation
  loopback-only listener
  idempotency and run state
  daily/run limits
  Telegram outbox
  LLM cover letters

PostgreSQL 16
Telegram Bot API
Groq API
```

Backend обязан слушать только `127.0.0.1:8080`. Каждый запрос extension к
backend требует header `X-Local-Secret`, совпадающий с `LOCAL_SHARED_SECRET`.

## Структура репозитория

```text
hh-personal-applier/
├─ README.md
├─ AGENTS.md
├─ CLAUDE.md
├─ Pipeline_razrabotki_browser_extension.md
├─ docker-compose.yml
├─ Makefile
├─ .env.example
├─ docs/
│  ├─ assets/                 # screenshots for README
│  ├─ runbook.md              # recovery flows
│  └─ selectors.md            # hh.ru selector map
├─ backend/
│  ├─ cmd/server/main.go
│  ├─ internal/api/           # local REST API
│  ├─ internal/config/        # env validation
│  ├─ internal/storage/       # storage contracts
│  ├─ internal/storage/postgres/
│  ├─ internal/telegram/
│  ├─ internal/llm/
│  ├─ internal/coverletter/
│  ├─ internal/logging/
│  ├─ migrations/
│  ├─ go.mod
│  └─ go.sum
└─ extension/
   ├─ manifest.json
   ├─ build.mjs
   ├─ package.json
   ├─ src/
   │  ├─ background/index.ts
   │  ├─ content/search.ts
   │  ├─ content/vacancy.ts
   │  ├─ popup/
   │  └─ shared/
   └─ test/
```

## Быстрый старт

Требования:

- Go 1.26.
- Node.js 20+.
- Docker / Docker Compose для локального PostgreSQL 16.
- Chrome с включённым Developer mode.
- Telegram bot token и numeric owner chat id, если нужны уведомления.
- Groq API key, если нужны LLM cover letters.

1. Подготовить env:

```bash
cp .env.example .env
openssl rand -base64 32
```

Сгенерированное значение вставить в `.env` как `LOCAL_SHARED_SECRET`. Этот же
секрет нужно позже вставить в popup extension в поле `X-Local-Secret`.

2. Заполнить обязательные значения в `.env`:

```text
LOCAL_SHARED_SECRET=...
DATABASE_DSN=postgres://postgres:postgres@127.0.0.1:5432/hh_personal?sslmode=disable
TELEGRAM_BOT_TOKEN=...
TELEGRAM_OWNER_CHAT_ID=...
LLM_PROVIDER=groq
LLM_API_KEY=...
LLM_MODEL=llama-3.3-70b-versatile
```

3. Установить зависимости extension:

```bash
cd extension
npm install
cd ..
```

4. Поднять Postgres и backend:

```bash
make up
```

`make up` запускает Docker Compose и затем backend. Backend должен стартовать
на `127.0.0.1:8080`.

5. Собрать extension:

```bash
cd extension
npm run build
cd ..
```

6. Загрузить extension в Chrome:

- открыть `chrome://extensions`;
- включить Developer mode;
- нажать `Load unpacked` / `Загрузить распакованное расширение`;
- выбрать папку `extension/dist`;
- открыть popup extension;
- вставить `http://127.0.0.1:8080` и `LOCAL_SHARED_SECRET`;
- нажать `Save`, затем `Check`.

## Как пользоваться

1. Войти в свой аккаунт на `https://hh.ru` обычным Chrome-профилем.
2. Открыть страницу поиска вакансий:
   `https://hh.ru/search/vacancy?...`.
3. Открыть popup extension и проверить, что backend status = `OK`.
4. Настроить лимиты:
   - `Daily limit`: максимум откликов за день.
   - `Run limit`: максимум откликов за один Start.
   - `Pace min/max`: пауза между кликами в секундах.
   - `Skip vacancies with tests`: не откликаться на вакансии с тестом.
   - `Skip external responses`: не уходить во внешние формы.
   - `Require Telegram approval for letters`: письма только после approval.
   - `Auto apply without popup confirmation`: автоматический клик без
     подтверждения в popup. Для тестирования держите выключенным.
5. Нажать `Start`.
6. Если `autoApply=false`, подтверждать или пропускать каждую вакансию в popup.
7. Нажать `Stop`, если цикл нужно прервать немедленно.
8. После CAPTCHA, login loss, unknown modal или network pause вручную устранить
   причину и нажать `Continue`.

Нормальные завершения: достигнут дневной лимит, достигнут run limit или на
текущей выдаче больше нет подходящих вакансий. Safety stop требует внимания
владельца.

## Настройки по умолчанию

```text
DEFAULT_DAILY_LIMIT=100
DEFAULT_RUN_LIMIT=25
MAX_DAILY_LIMIT=200
MAX_RUN_LIMIT=100
DEFAULT_PACE_MIN_SECONDS=6
DEFAULT_PACE_MAX_SECONDS=14
COVER_LETTER_TTL_HOURS=1
```

Источник истины для лимитов, counters, idempotency и run state - Go backend +
Postgres. `chrome.storage.local` используется только для bootstrap/UI cache.

## Основные backend endpoints

Все endpoints требуют `X-Local-Secret`.

- `GET /health` - проверка backend.
- `GET /settings` и `PUT /settings` - настройки владельца.
- `GET /stats/today` - статистика, remaining daily и recent vacancies.
- `POST /candidates` - фильтрация кандидатов и allow-list.
- `POST /attempts/start` - запись `attempting` перед кликом.
- `POST /applied` - финальный результат отклика.
- `GET /runs/active` - активный run и состояние pause/stop.
- `POST /events/*` - события safety stop.
- `POST /telegram/test` - тестовое Telegram-сообщение.
- `GET /cover_letters/{vacancy_id}` - polling approval результата.

## Разработка и проверки

Backend:

```bash
cd backend
go fmt ./...
go vet ./...
go test ./...
```

Extension:

```bash
cd extension
npm run typecheck
npm run lint
npm test
npm run build
```

Полный локальный smoke для beta:

- popup `Check` видит backend;
- Telegram test message доходит владельцу;
- selector smoke на реальной выдаче `hh.ru/search/vacancy`;
- Start на 1-5 вакансиях с `autoApply=false`;
- Stop во время pacing;
- симуляция CAPTCHA/login lost/unknown modal;
- cover-letter vacancy через Telegram approve/skip;
- проверка, что backend недоступен с адресов кроме `127.0.0.1`.

Автоматические browser tests против реального `hh.ru` не запускаются: это
запрещено правилами проекта.

## Статус beta-тестирования

`0.1beta` фиксирует минимально необходимый рабочий контур:

- локальный backend + Postgres;
- MV3 extension, загружаемый через Developer mode;
- ручной Start/Stop/Continue из popup;
- лимиты, pacing и dashboard;
- click flow для вакансий без обязательного письма;
- Telegram outbox и approval flow для LLM cover letters;
- safety stops без CAPTCHA solving и без anti-detection.

Перед использованием на длинных реальных сессиях остаются обязательные
acceptance-проверки: manual smoke на `hh.ru`, реальные Postgres integration
checks, selector verification после изменений DOM HH и проверка recovery
сценариев из [`docs/runbook.md`](docs/runbook.md).

## Git и релизы

Remote:

```text
https://github.com/DenisKhanov/hh-personal-applier.git
```

Рабочая ветка разработки может отличаться от `main`; публикация в `main`,
создание tag/release и push выполняются только по явному запросу владельца.
