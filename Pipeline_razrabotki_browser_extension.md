# Pipeline разработки: HH Personal Applier (Chrome extension)

> **Назначение проекта:** личный инструмент одного владельца. Браузерное расширение Chrome автоматизирует клики «Откликнуться» в **собственной залогиненной сессии** пользователя на `hh.ru`. Это макрос поверх живого UI, а не серверный бот, не парсер, не имитация другого юзера.
>
> **Контекст:** возник после полного закрытия публичного API HH для соискателей 15.12.2025. Предшественник (`AutoApply AI`, тэг `v0.1.0-api-frozen`) построен на applicant API и заморожен.

---

## 0. Принципы и красные линии

### 0.1 Принципы

- [ ] **Один пользователь, один аккаунт, один браузер.** Нет multi-user, нет SaaS, нет распространения.
- [ ] **Расширение работает только при активном пользователе.** Никаких фоновых cron-запусков. «Старт» запускается из popup явным кликом владельца, останавливается автоматически или вручную.
- [ ] **Низкий темп и управляемые лимиты.** 5-15 секунд между откликами с jitter. Дневной лимит и лимит за один запуск задаются владельцем в настройках; дефолты: 100 откликов в день, 25 за один Start. Цель — реальный поиск работы, не массовый спам.
- [ ] **Любая неожиданность = стоп.** CAPTCHA, изменение DOM, network error, потеря логина, неожиданный модал — расширение останавливается и зовёт пользователя через chrome notification + Telegram.
- [ ] **Финальное «нет» всегда у пользователя.** Кнопка «Стоп» в popup мгновенно прерывает цикл; настройка «требовать подтверждение каждого отклика» включается одним переключателем.
- [ ] **Open code (для себя).** Прозрачный исходник, никаких minified-блобов, никаких внешних SDK с непрозрачным поведением.

### 0.2 Красные линии (что проект НЕ делает)

- [ ] **Никакого anti-detection.** Не подменяем `navigator.webdriver`, не рандомизируем fingerprint, не маскируем расширение, не эмулируем мышь под поведенческие паттерны человека для обмана детектора. Расширение работает в обычном Chrome владельца — потому что HH видит реального юзера, иной маскировки не нужно.
- [ ] **Никакого CAPTCHA solving.** Если HH показал капчу — расширение замирает, шлёт алерт, ждёт пока владелец решит её вручную и нажмёт «Продолжить» в popup.
- [ ] **Никаких прокси, IP-ротации, headless Chrome, residential proxies, ботнетов.**
- [ ] **Никакого парсинга чужих данных, чужих аккаунтов, чужих cookies.** Только то, что доступно в DOM текущей вкладки владельца.
- [ ] **Никакой коммерциализации, продажи как сервиса, выкладывания в Chrome Web Store как публичного продукта.** Личный инструмент, грузится через Developer mode «Загрузить распакованное расширение».
- [ ] **Никаких отправок откликов на вакансии, требующие сопроводительное письмо без явного подтверждения пользователем.** Письмо генерируется LLM, показывается в Telegram, отправляется только после approve.

---

## 1. Высокоуровневая архитектура

```
┌─────────────────────────────────────────────────┐
│            Chrome (профиль владельца)           │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Chrome Extension (MV3)                 │   │
│  │  ─ popup UI (старт/стоп/настройки)      │   │
│  │  ─ background service worker (orchestr) │   │
│  │  ─ content scripts (hh.ru/search, /vac) │   │
│  └─────────────────────────────────────────┘   │
│        │                       │                │
│        │ DOM read/click        │ fetch          │
│        ▼                       ▼                │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │ hh.ru pages  │    │ http://127.0.0.1:8080│  │
│  └──────────────┘    └──────────────────────┘  │
└─────────────────────────────────────────────────┘
                                │
                                ▼
                ┌─────────────────────────────────┐
                │   Local Go backend              │
                │   ─ idempotency check           │
                │   ─ settings + daily/run limits │
                │   ─ statistics                  │
                │   ─ Telegram outbox             │
                │   ─ LLM cover letters (Groq)    │
                └────────────┬───────────┬────────┘
                             │           │
                             ▼           ▼
                       ┌──────────┐  ┌─────────────┐
                       │ Postgres │  │ Telegram    │
                       │ (Docker) │  │ (telebot.v3)│
                       └──────────┘  └─────────────┘
```

### 1.1 Разделение ответственности

| Слой | Ответственность |
|---|---|
| **Content script** | Парсит карточки вакансий из DOM. Кликает «Откликнуться». Детектит CAPTCHA / login loss / unknown modal. **Не принимает решений** — только наблюдает и выполняет команды. |
| **Background worker** | Цикл оркестрации: «получить от content script список вакансий → запросить у backend allow-list → сказать content script кликать → дождаться результата → записать в backend». Pacing, retry-on-network. |
| **Popup** | UI: старт/стоп, дневной лимит, лимит за запуск, фильтры, статус, последние 10 действий, кнопка «Подтверди CAPTCHA». |
| **Local Go backend** | Состояние: что уже откликнулись, сколько за день, какие письма сгенерированы, очередь Telegram. **Не лезет в Chrome**, не имеет доступа к hh.ru — общается только с extension. |
| **Postgres** | Хранилище состояния. Одна локальная инсталляция через Docker Compose. |
| **Telegram bot** | Только outbound уведомления + approve cover letters. Не управляет циклом. |

### 1.2 Что переиспользуется из `AutoApply AI` (frozen)

- ✅ `internal/config` идея валидации env (упрощается).
- ✅ `internal/logging` структурированный slog.
- ✅ Подход к миграциям через `golang-migrate`.
- ✅ Спека ошибок HH (§17 предшественника) — там, где она применима к UI-уровню, а не API.
- ✅ LLM cover letter подход (§11–§13 предшественника).
- ✅ Telegram outbox pattern (§21 предшественника).
- ❌ HH OAuth client — выкидывается полностью.
- ❌ Token cipher — выкидывается.
- ❌ `cmd/worker`, `cmd/scheduler` — расписания нет, всё driver-driven из расширения.
- ❌ Двухфазная запись `applying`/`applied` через HH API — не релевантно (отклик идёт через UI).
- ✅ Локальный журнал попыток перед кликом всё равно нужен: перед нажатием «Откликнуться» backend фиксирует `attempting`, после результата переводит в `applied`/`manual_action`/`error`. Если расширение или вкладка упали после клика, следующая сессия не должна автоматически кликать эту вакансию повторно.

---

## 2. Технологический стек

### 2.1 Расширение Chrome

- [ ] **Manifest V3.** Background — service worker (не persistent page).
- [ ] **TypeScript** + `tsc` + `esbuild` (минимальная сборка, без webpack-комбайна).
- [ ] **Manifest permissions:** `activeTab`, `scripting`, `storage`, `notifications`. **Host permissions:** минимум `https://hh.ru/*` и `http://127.0.0.1:8080/*`; региональные `https://*.hh.ru/*` добавлять только если владелец реально ими пользуется. Никаких `<all_urls>`.
- [ ] **Storage:** `chrome.storage.local` только для bootstrap/UI cache (`localBackendUrl`, secret, последний settings snapshot). Источник истины для safety-настроек и состояния — Go-бэкенд + Postgres. IndexedDB не используем.
- [ ] **Никаких внешних JS-зависимостей в runtime extension.** Утилиты пишем сами. Минимальный TS + DOM API.
- [ ] **Вёрстка popup — vanilla CSS** (~200 строк). UI-фреймворки избыточны.

### 2.2 Local Go backend

- [ ] **Go 1.23+** (соответствует hh-auto-apply-agent).
- [ ] **`net/http` + huma/v2** для REST (как в frozen-проекте).
- [ ] **PostgreSQL 16** через Docker Compose, локально на `127.0.0.1:5432`.
- [ ] **`pgx/v5`** через `database/sql`.
- [ ] **`golang-migrate`** для миграций.
- [ ] **`gopkg.in/telebot.v3`** для Telegram.
- [ ] **`slog`** для логов.
- [ ] **Listen address: строго `127.0.0.1:8080`.** Бэкенд не должен быть доступен извне машины.
- [ ] **Auth между extension и backend:** простой shared secret, генерируется при первом запуске, кладётся в `chrome.storage.local` и в `.env` бэкенда. Каждый запрос: header `X-Local-Secret`.

### 2.3 LLM (cover letters)

- [ ] **Groq** (free tier), модель `llama-3.3-70b-versatile`. Provider за интерфейсом — заменяемо.
- [ ] LLM-вызовы только из Go-бэкенда (не из расширения), чтобы API key не утёк в браузер.

### 2.4 Что НЕ используется

- [ ] Никакого Next.js, никакого web-фронтенда. Popup расширения — единственный UI.
- [ ] Никакого Redis.
- [ ] Никакого OAuth (ни HH, ни своего).
- [ ] Никакого Docker для production — production это локальный Chrome владельца. Docker нужен только для Postgres.

---

## 3. Структура репозитория

```
hh-personal-applier/
├─ Pipeline_razrabotki_browser_extension.md   # этот файл
├─ AGENTS.md                                  # короткие правила для code-agent
├─ README.md                                  # как поднять у себя
├─ .gitignore
├─ docker-compose.yml                         # только postgres
├─ .env.example
│
├─ extension/                                 # Chrome MV3 extension
│  ├─ manifest.json
│  ├─ src/
│  │  ├─ background/index.ts                  # service worker
│  │  ├─ content/search.ts                    # на /search/vacancy
│  │  ├─ content/vacancy.ts                   # на /vacancy/{id}
│  │  ├─ popup/index.html, index.ts, style.css
│  │  ├─ shared/api.ts                        # клиент к локальному Go API
│  │  ├─ shared/messages.ts                   # типы сообщений между слоями
│  │  └─ shared/selectors.ts                  # CSS-селекторы hh.ru (хрупкое место)
│  ├─ tsconfig.json
│  ├─ package.json
│  └─ build.mjs                               # esbuild
│
├─ backend/                                   # local Go server
│  ├─ cmd/server/main.go
│  ├─ internal/config/
│  ├─ internal/api/                           # REST endpoints для extension
│  ├─ internal/storage/postgres/
│  ├─ internal/llm/                           # Groq cover letters
│  ├─ internal/telegram/                      # outbound bot
│  ├─ internal/logging/
│  ├─ go.mod, go.sum
│  └─ migrations/
│
└─ docs/
   ├─ selectors.md                            # карта DOM-селекторов hh.ru с датой проверки
   └─ runbook.md                              # как реагировать на CAPTCHA, login loss, etc
```

---

## 4. Data model (минимальная)

Только то, что реально нужно в personal-режиме.

### 4.1 `processed_vacancies`
Идемпотентность: чтобы повторно не открывать одну и ту же вакансию. Перед любым реальным кликом создаётся/обновляется запись `attempting`; финальный статус пишется только после понятного результата.

```sql
CREATE TABLE processed_vacancies (
    vacancy_id TEXT PRIMARY KEY,            -- HH vacancy id из URL
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
```

Без `user_id`, без `search_direction_id`, без `negotiation_id` (его в UI-режиме нет).

### 4.2 `daily_apply_stats`
Дневной счётчик, ничего более.

```sql
CREATE TABLE daily_apply_stats (
    date DATE PRIMARY KEY,
    applied_count INT NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
    skipped_count INT NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
    error_count INT NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    captcha_pause_count INT NOT NULL DEFAULT 0 CHECK (captcha_pause_count >= 0)
);
```

Дата считается в `APP_TIMEZONE` (по умолчанию `Europe/Moscow`), а не в UTC, чтобы дневной лимит совпадал с реальным днём владельца.

### 4.3 `notifications_outbox`
Outbox для Telegram (тот же паттерн что в frozen-проекте).

```sql
CREATE TABLE notifications_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN (
        'captcha', 'error', 'daily_limit_reached',
        'cover_letter_approval', 'daily_report', 'login_lost'
    )),
    payload JSONB NOT NULL,
    -- dedup_key предотвращает повторную отправку однотипных нотификаций
    -- (например, daily_limit_reached дважды за один день после рестарта).
    -- Формат: '<kind>:<date-or-vacancy_id>'. NULL = без дедупликации.
    dedup_key TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.4 `cover_letters`
Кэш сгенерированных писем + ссылка на pending approval.

```sql
CREATE TABLE cover_letters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vacancy_id TEXT NOT NULL,
    vacancy_title TEXT,
    body TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('ru','en')),
    status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
        'pending_approval', 'approved', 'skipped', 'expired'
    )),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(vacancy_id)
);
```

TTL подтверждения письма — 1 час, после — auto-`expired`, вакансия пропускается.

### 4.5 `owner_settings`
Единственная строка с настройками владельца. Popup редактирует их через backend API; `chrome.storage.local` хранит только последний snapshot для UI.

**Сидинг:** миграция должна содержать `INSERT INTO owner_settings DEFAULT VALUES ON CONFLICT DO NOTHING`, чтобы строка существовала с момента запуска без ручного init.

```sql
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
```

### 4.6 `apply_runs`
Один Start = один run. Это нужно, чтобы `owner_settings.run_limit` переживал перезапуск MV3 service worker и чтобы можно было понять, почему сессия остановилась.

```sql
CREATE TABLE apply_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
        'running', 'paused_captcha', 'paused_unknown',
        'paused_network', 'stopped', 'completed'
    )),
    search_url TEXT NOT NULL,
    -- Снимок owner_settings на момент старта run; лимиты фиксируются здесь
    -- и не меняются, даже если владелец изменит настройки mid-run.
    settings_snapshot JSONB NOT NULL,
    applied_count INT NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
    skipped_count INT NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
    error_count INT NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    stop_reason TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stopped_at TIMESTAMPTZ
);
```

---

## 5. Конфигурация

`.env` файл локально:

```dotenv
APP_PORT=8080
APP_BIND=127.0.0.1
APP_TIMEZONE=Europe/Moscow
LOCAL_SHARED_SECRET=<32+ символов, генерируется при первой установке>

DATABASE_DSN=postgres://postgres:postgres@127.0.0.1:5432/hh_personal?sslmode=disable

TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_OWNER_CHAT_ID=<chat_id>

LLM_PROVIDER=groq
LLM_API_KEY=<groq key>
LLM_MODEL=llama-3.3-70b-versatile

DEFAULT_DAILY_LIMIT=100
DEFAULT_RUN_LIMIT=25
MAX_DAILY_LIMIT=200
MAX_RUN_LIMIT=100
DEFAULT_PACE_MIN_SECONDS=6
DEFAULT_PACE_MAX_SECONDS=14
COVER_LETTER_TTL_HOURS=1
```

`chrome.storage.local` (на стороне extension):

```ts
{
  localBackendUrl: "http://127.0.0.1:8080",
  localSharedSecret: "...",        // тот же что в .env
  enabled: false,                   // глобальный rocker on/off
  settingsCache: {                  // UI cache; source of truth в backend
    dailyLimit: 100,
    runLimit: 25,
    paceMinSeconds: 6,
    paceMaxSeconds: 14,
    autoApply: false,               // false = popup-подтверждение перед каждым кликом (см. §6.4)
    filters: {
      skipWithTest: true,
      skipExternal: true,
      requireCoverLetterApproval: true,
    },
  }
}
```

---

## 6. Browser-side flow (auto-apply)

### 6.1 Состояния расширения

```
idle ──user clicks Start──> running
running ──daily limit reached──> idle
running ──run limit reached──> idle
running ──user clicks Stop──> idle
running ──CAPTCHA detected──> paused_captcha
running ──unknown modal / DOM error──> paused_unknown
running ──network error to backend──> paused_network
paused_* ──user resolves + clicks Continue──> running
paused_captcha ──timeout 30 min──> idle (с уведомлением)
```

### 6.2 Цикл running

1. Owner на странице `https://hh.ru/search/vacancy?...` со своими фильтрами.
2. Popup/Background → Go backend `POST /runs/start { search_url }`, backend создаёт `apply_runs.id`, snapshot текущих `owner_settings` и возвращает `runId`.
3. Background worker → content script `search.ts`: «верни список карточек».
4. Content script возвращает массив `{ vacancyId, title, employer, hasTest, isExternal, isArchived, requiresLetter }` — все данные из DOM текущей выдачи.
5. Background → Go backend `POST /candidates { run_id, items }`: «вот N кандидатов, дай мне список IDs которые можно открыть».
6. Backend фильтрует через `processed_vacancies` (исключая уже-пройденные и `attempting`) + проверяет остаток `daily_limit` и `run_limit`.
7. Background для каждого approved id:
   - Жди `random(paceMinSeconds, paceMaxSeconds)` секунд из settings snapshot.
   - Открой страницу вакансии в той же вкладке через `chrome.tabs.update(tabId, { url })` из background worker.
   - Загрузился `vacancy.ts` content script.
   - `POST /attempts/start { run_id, vacancy_id }` — backend ставит `processed_vacancies.status='attempting'`. **Это делается до любого клика**, включая letter-flow, чтобы падение после первого клика не привело к повторному авто-клику.
   - Если `requiresLetter && requireCoverLetterApproval` → backend генерит письмо, шлёт в Telegram approve, запоминает `cover_letters.id`. Расширение **не кликает** «Откликнуться» пока статус не `approved`. На `expired` (TTL вышел) или Telegram «Пропустить» → `POST /vacancies/result { status: "skipped_cover_letter" }`.
   - Если `requiresLetter && !requireCoverLetterApproval` → backend генерит письмо, сразу возвращает текст без Telegram approval, extension вставляет в textarea и кликает «Отправить» (см. §9).
   - Если `autoApply=false` → background ставит popup в режим «ожидание подтверждения» с заголовком и работодателем. Цикл ждёт клика «Подтвердить» или «Пропустить» в popup (см. §6.4). Таймаут ожидания — 5 минут, после — вакансия `skipped`, цикл продолжается.
   - Если `!requiresLetter` (или `approved`/auto-letter) → click «Откликнуться» → проверь, что появился success state (например, кнопка сменилась на «Отклик отправлен»).
   - На success: `POST /vacancies/result { run_id, vacancy_id, status: "applied", ... }`.
   - На failure (модал «откройте чат», «требуется подтверждение телефона», «прохождение теста»): `POST /vacancies/result { status: "manual_action" }`, переход к следующей.
8. После исчерпания списка — вернуться к `/search/vacancy`, обновить страницу, повторить или завершить run через `POST /runs/stop`.

### 6.3 Пагинация

Когда все вакансии текущей страницы выдачи исчерпаны (approve-list пуст и `run_limit` ещё не достигнут), background worker:

1. Определяет URL следующей страницы: добавляет/инкрементирует параметр `page` к `search_url`.
2. Переходит через `chrome.tabs.update(tabId, { url: nextPageUrl })`.
3. После загрузки `search.ts` повторяет цикл с шага 3 §6.2.
4. Если следующей страницы нет (content script вернул пустой список) — run завершается через `POST /runs/stop { reason: "no_more_vacancies" }`.

Параллельных вкладок нет; пагинация идёт последовательно в той же вкладке.

### 6.4 `autoApply=false` — popup-подтверждение

Когда `autoApply=false` в settings snapshot run'а:

1. Background worker перед каждым кликом «Откликнуться» отправляет popup сообщение `{ type: "CONFIRM_REQUEST", vacancyId, title, employer, url }`.
2. Popup переходит в состояние **«Ожидание подтверждения»**: показывает название, работодателя, ссылку и кнопки **«Подтвердить»** / **«Пропустить»**.
3. Background ждёт ответа (таймаут 5 минут).
4. «Подтвердить» → background продолжает клик. «Пропустить» или таймаут → `POST /vacancies/result { status: "skipped" }`, переход к следующей.
5. Если popup закрыт и не отвечает дольше таймаута — считается «Пропустить».

`autoApply=false` не отменяет cover letter approval — если письмо тоже требует approval, оба шага выполняются последовательно (сначала Telegram, потом popup-клик).

### 6.5 Recovery после `paused_*` и `unknown_after_click`

| Состояние | Как владелец разрешает | Действие |
|---|---|---|
| `paused_captcha` | Решает капчу вручную, нажимает «Продолжить» в popup | `POST /runs/continue { run_id }` → backend ставит статус `running` |
| `paused_unknown` / `paused_network` | Нажимает «Продолжить» или «Стоп» в popup | Continue → `running`; Stop → `stopped` |
| Вакансия в `unknown_after_click` | В popup (список последних откликов) рядом с вакансией — кнопки «Засчитать как applied» / «Пропустить» | `POST /vacancies/result { status: "applied"/"skipped" }` с флагом `manual_override: true` |

Backend при `POST /runs/continue` проверяет, что run существует и находится в `paused_*` — иначе 409.

### 6.6 Что content script НЕ делает

- Не делает запросы за пределы текущего hh.ru tab.
- Не пишет/не читает cookies.
- Не пытается обойти CAPTCHA (если видит её — `chrome.runtime.sendMessage` background-у `{ type: "CAPTCHA_DETECTED" }` и завершается).
- Не модифицирует страницу для пользователя (не подсвечивает, не добавляет UI). UI весь в popup.

---

## 7. Pacing и safety stops

### 7.1 Pacing

- [ ] Между двумя последовательными `click Откликнуться` — не меньше `paceMinSeconds` секунд + jitter до `paceMaxSeconds`. По умолчанию 6-14, настраивается в popup, backend валидирует `paceMinSeconds <= paceMaxSeconds`.
- [ ] Между сессиями (после Stop → Start) — без задержки, это ручной триггер.
- [ ] Параллельных вкладок нет: всё в одной вкладке последовательно.

### 7.2 Safety stops (любой → cycle stops, alert)

- [ ] **CAPTCHA detected.** Селекторы — в `docs/selectors.md`. Stop, alert в Telegram, popup status «решите CAPTCHA вручную и нажмите Продолжить».
- [ ] **Login lost.** Если на странице вакансии нет элемента «Откликнуться» и есть «Войти / Зарегистрироваться» — login истёк. Stop, alert.
- [ ] **Unknown modal.** Если после клика «Откликнуться» появился неизвестный модал (не тот шаблон success / письмо / test required) — stop, alert. Лучше пропустить вакансию, чем нажать «не туда».
- [ ] **DOM mismatch.** Если ключевые селекторы не находятся (button «Откликнуться», карточка вакансии в выдаче) — стоп. Это сигнал что hh.ru поменял вёрстку и расширение нужно обновлять.
- [ ] **Network error → backend.** 3 retries с backoff, потом stop.
- [ ] **Daily limit.** При достижении `owner_settings.daily_limit` — stop, daily report в Telegram.
- [ ] **Run limit.** При достижении `owner_settings.run_limit` за один Start — stop без алерта (нормальное завершение).

---

## 8. Error handling и фильтры (UI-уровень)

Так как мы видим только то, что HH показывает на странице, классификация **на DOM-уровне**, а не на API-кодах.

| Ситуация на странице | Действие | Запись |
|---|---|---|
| В карточке выдачи: метка «Архив» / нет кнопки Откликнуться | Skip, не открывать | `skipped_archived` |
| В карточке: «Требуется тестовое задание» (или открытая страница это говорит) | Skip | `skipped_test` |
| Кнопка «Откликнуться на сайте компании» (response_url) | Skip | `skipped_external` |
| После клика: «Вы уже откликались» | Skip | `skipped_already_applied` |
| После клика: выбор резюме (не должно происходить — одно резюме, автовыбор) | Если модал всё же появился — `manual_action`, алерт | `manual_action` |
| После клика: подтверждение телефона, обязательные вопросы или другой интерактивный модал | Stop/ручное действие | `manual_action` |
| После клика: модал «требуется сопроводительное письмо», `requireCoverLetterApproval=true` | LLM генерация → Telegram approval → wait | (cover_letter pending) |
| После клика: модал «требуется сопроводительное письмо», `requireCoverLetterApproval=false` | LLM генерация → auto-вставка без approve | `applied` (или `error`) |
| Cover letter TTL истёк или Telegram «Пропустить» | Skip вакансию | `skipped_cover_letter` |
| После клика: появилась форма с дополнительными вопросами | Skip + manual_action алерт | `manual_action` |
| После клика: success state | Записать | `applied` |
| Сетевая ошибка / timeout страницы | Skip эту вакансию, **не stop**, попробовать следующую | `error` |
| Дублирующиеся / неожиданные модалы 2+ подряд | Stop весь цикл | (нет записи) |

---

## 9. LLM cover letters

- [ ] LLM вызывается **только** из Go-бэкенда, ключ Groq никогда не попадает в extension.
- [ ] Prompt template, language detection, `cover_letter_guard` (regex + длина) — переносятся из §11-§13 frozen-проекта почти как есть. Адаптация: убирается интеграция с HH `negotiations` API, добавляется persistence в `cover_letters`.
- [ ] **Approval flow (`requireCoverLetterApproval=true`, дефолт):**
  1. Extension сообщает backend «нужно письмо для vacancy_id=X, заголовок=Y, описание=Z».
  2. Backend вызывает LLM, прогоняет через guard (max 3 попытки).
  3. Backend: `INSERT cover_letters (status='pending_approval', expires_at=now()+1h)` и в `notifications_outbox` сообщение в Telegram с inline-кнопками «Отправить / Изменить / Пропустить».
  4. Telegram bot (часть backend) обрабатывает callback → `UPDATE cover_letters.status='approved'/'skipped'`. Повторный callback по тому же `vacancy_id` — ноп (первый валидный ответ выигрывает).
  5. Extension long-poll `GET /cover_letters/{vacancy_id}` с интервалом 5s.
  6. На `approved` — extension вставляет текст в textarea модала и кликает «Отправить».
  7. На `skipped` (Telegram «Пропустить») или `expired` (TTL вышел) → `POST /vacancies/result { status: "skipped_cover_letter" }`, переход к следующей.
- [ ] **Auto-flow (`requireCoverLetterApproval=false`):**
  1-2. Те же шаги: LLM + guard.
  3. Backend: `INSERT cover_letters (status='approved', expires_at=now()+1h)` — сразу `approved`, без Telegram. Уведомление в Telegram не шлётся (не нужно approve).
  4. Backend возвращает текст письма в ответе на `POST /cover_letters/request`.
  5. Extension вставляет текст в textarea и кликает «Отправить» без polling.
  **Ограничение:** `requireCoverLetterApproval=false` — осознанный выбор владельца. Backend принимает его только в сочетании с явным `autoApply=true`; если `autoApply=false` — auto-letter всё равно используется, но popup-подтверждение клика остаётся (§6.4).
- [ ] Fallback при rate limit Groq: одно уведомление в Telegram «лимит LLM, режим без писем», текущая вакансия → `skipped`, дальше работаем только с no-letter вакансиями до Stop.

---

## 10. Telegram

- [ ] Outbox-pattern из frozen-проекта.
- [ ] **Два канала уведомлений** (дублируются для надёжности):
  - **`chrome.notifications`** — немедленный локальный алерт (chrome.notifications.create), пока владелец за компьютером.
  - **Telegram outbox** — асинхронная доставка через backend; работает даже если popup закрыт.
- [ ] Уведомления, которые шлём:
  - `captcha` — оба канала, мгновенно, требует действия владельца.
  - `error` — оба канала, мгновенно, для DOM mismatch / network / 3+ retries.
  - `daily_limit_reached` — только Telegram, раз в день; dedup_key = `daily_limit_reached:<date>`.
  - `cover_letter_approval` — только Telegram, с inline кнопками (chrome notification без интерактива бессмыслен).
  - `daily_report` — только Telegram, в 23:55 `APP_TIMEZONE`; dedup_key = `daily_report:<date>`.
  - `login_lost` — оба канала, мгновенно.
- [ ] Inline-кнопки только для `cover_letter_approval`. Остальное — текст.
- [ ] Bot принимает один callback от одного `TELEGRAM_OWNER_CHAT_ID`. Любой другой chat — игнор.

---

## 11. Логирование и приватность

- [ ] Структурированные логи `slog` в Go-бэкенде. Уровни: `debug` (dev), `info` (default).
- [ ] **Никогда не логируем:** `LOCAL_SHARED_SECRET`, `LLM_API_KEY`, `TELEGRAM_BOT_TOKEN`, полный текст cover letter (только длина + первые 80 символов).
- [ ] **Логируем:** vacancy_id, status переходы, длительность LLM-вызова, статус Telegram outbox, ошибки DOM с timestamp.
- [ ] Расширение пишет логи в `console.log` в DevTools popup-а; не пересылает их наружу.
- [ ] Postgres логи — стандартные docker, не пересылаем.
- [ ] Никакой аналитики, телеметрии, отправки в облако.

---

## 12. Реализация по этапам

### Этап 0. Bootstrap нового проекта
- [ ] `git init` в `hh-personal-applier/`. Не пушить — пока локальный, обсудить вынос в private GitHub отдельно.
- [ ] `.gitignore`: `node_modules/`, `extension/dist/`, `backend/bin/`, `.env`, `*.log`.
- [ ] `README.md` (короткий, как поднять локально).
- [ ] `AGENTS.md` (правила для code-agent: по аналогии со старым, но отражающие новую парадигму).
- [ ] `docker-compose.yml` только с Postgres.
- [ ] `.env.example`.

### Этап 1. Backend skeleton
- [ ] `go.mod`, базовая структура `cmd/server/main.go`.
- [ ] `internal/config` — загрузка и валидация env (TELEGRAM_*, DATABASE_DSN, LLM_*, LOCAL_SHARED_SECRET >= 32, APP_TIMEZONE, DEFAULT_*/MAX_* лимиты, listen `127.0.0.1:8080` строго).
- [ ] `internal/logging` — slog адаптер (можно скопировать из frozen).
- [ ] Postgres connection.
- [ ] Migrations: `processed_vacancies`, `daily_apply_stats`, `notifications_outbox`, `cover_letters`, `owner_settings`, `apply_runs`. Финальная миграция — seed `owner_settings`: `INSERT INTO owner_settings DEFAULT VALUES ON CONFLICT DO NOTHING`.
- [ ] Middleware: проверка `X-Local-Secret` header.
- [ ] `GET /health` → 200.
- [ ] Graceful shutdown.

### Этап 2. Extension skeleton
- [ ] `manifest.json` MV3 с минимальным набором permissions.
- [ ] Build pipeline: `tsc` + `esbuild`.
- [ ] Popup UI: статический «Hello + Health check к localhost backend».
- [ ] Background service worker: пустой, регистрируется.
- [ ] Установка в Chrome через Developer mode → проверка что popup открывается, health-check проходит.

### Этап 3. Backend ↔ Extension API
- [ ] `GET /settings` и `PUT /settings` → popup читает/сохраняет `dailyLimit`, `runLimit`, pacing и фильтры; backend валидирует диапазоны.
- [ ] `POST /runs/start { search_url }` → создаёт `apply_runs`, возвращает `run_id` и settings snapshot.
- [ ] `POST /runs/stop { run_id, reason }` → завершает/останавливает run.
- [ ] `POST /runs/continue { run_id }` → переводит run из `paused_*` в `running`; 409 если run не в paused-состоянии.
- [ ] `POST /candidates { run_id, items: [{vacancy_id, ...}] }` → возвращает `allow: [vacancy_id, ...]` (фильтрует по `processed_vacancies` + remaining daily/run limit).
- [ ] `POST /attempts/start { run_id, vacancy_id, ... }` → ставит `processed_vacancies.status='attempting'` перед кликом.
- [ ] `POST /vacancies/result { run_id, vacancy_id, status, vacancy_title, employer_name, vacancy_url, notes }` → финализирует `processed_vacancies` + инкрементит `daily_apply_stats` и `apply_runs`. **Идемпотентность:** повторный вызов с тем же `(run_id, vacancy_id)` и terminal status — ноп (200 без двойного счётчика). Поддерживает флаг `manual_override: true` для ручного разрешения `unknown_after_click` из popup.
- [ ] `GET /stats/today` → `{applied, skipped, errors, remainingDaily, activeRun}`.
- [ ] `POST /events/captcha`, `POST /events/login_lost`, `POST /events/error` — пишут в `notifications_outbox`.
- [ ] Юнит-тесты на handlers с mock storage.

### Этап 4. Content scripts: чтение выдачи
- [ ] `selectors.md` — задокументировать селекторы выдачи hh.ru на текущую дату.
- [ ] `content/search.ts`: при загрузке `https://hh.ru/search/vacancy*` (и подтверждённых региональных hosts, если нужны) парсит карточки и шлёт в background.
- [ ] Background: `POST /runs/start`, затем запрос `POST /candidates`, получает allow-list, логирует в DevTools popup.
- [ ] **Без кликов**, только чтение и фильтрация.

### Этап 5. Auto-apply без писем
- [ ] `content/vacancy.ts`: при загрузке `https://hh.ru/vacancy/*` (и подтверждённых региональных hosts, если нужны) детектит и кликает «Откликнуться» (только если кнопка простая, без модала-письма).
- [ ] Pacing 6-14s между переходами.
- [ ] Детекция success state.
- [ ] `POST /attempts/start` строго перед кликом, чтобы crash после клика не привёл к повторному авто-клику.
- [ ] `POST /vacancies/result` после успеха или понятного skip/manual_action.
- [ ] Safety stops: CAPTCHA, login_lost, unknown modal, DOM mismatch.
- [ ] Кнопка Stop в popup мгновенно отменяет цикл.
- [ ] Тест-кейс: 5 вакансий без писем подряд, без падений.

### Этап 6. Telegram outbox
- [ ] `internal/telegram` адаптер (telebot.v3).
- [ ] Outbox dispatcher горутина: каждые 5s достаёт `pending`, отправляет, обновляет статус.
- [ ] Уведомления: `captcha`, `error`, `daily_limit_reached`, `daily_report`, `login_lost`.
- [ ] Daily report в 23:55 (cron внутри backend).

### Этап 7. LLM cover letters
- [ ] `internal/llm` — Groq adapter за интерфейсом.
- [ ] Prompt + language detection + `cover_letter_guard` (regex + длина) — портируется из §11-§13 frozen-проекта.
- [ ] `POST /cover_letters/request { vacancy_id, vacancy_title, vacancy_description }` → backend генерит, кладёт в `cover_letters` + Telegram approval.
- [ ] Telegram callback handler: «Отправить» / «Изменить» / «Пропустить».
- [ ] `GET /cover_letters/{vacancy_id}` для long-polling из extension.
- [ ] Content script: при модале «требуется письмо» → request → wait → fill textarea → click submit.

### Этап 8. Popup polish + run/daily limits + dashboard
- [ ] Popup показывает: статус (idle/running/paused), сегодня (applied/skipped/errors/remaining), кнопки Start/Stop/Continue.
- [ ] Настройки: `dailyLimit` (default 100, max 200), `runLimit` (default 25, max 100), `paceMinSeconds`, `paceMaxSeconds`.
- [ ] Переключатели: skipWithTest, skipExternal, requireCoverLetterApproval, autoApply.
- [ ] Список последних 10 откликов с кликабельным URL.
- [ ] Acceptance smoke: 1 рабочий день в режиме `requireCoverLetterApproval=true`, без падений, дневной отчёт в Telegram.

---

## 13. Definition of Done (личное использование MVP)

- [ ] Расширение загружается в Chrome через Developer mode.
- [ ] `make up` поднимает Postgres + backend локально.
- [ ] Владелец залогинен на hh.ru, кликает Start в popup, на странице `/search/vacancy?...` цикл стартует.
- [ ] Расширение проходит первые 5 вакансий без писем, успешно откликается, отображает счётчик.
- [ ] При появлении вакансии «требуется письмо» — генерация → Telegram approve → отправка работает end-to-end.
- [ ] CAPTCHA детектится → цикл встал → Telegram алерт пришёл.
- [ ] Stop в popup мгновенно прерывает цикл.
- [ ] Дневной лимит из настроек не превышается; default 100, можно выставить минимум 100 для личного режима.
- [ ] Дневной отчёт в Telegram приходит в 23:55.
- [ ] Никакой запрос не уходит за пределы `127.0.0.1` и явно настроенных HH host permissions.

---

## 14. Testing

### Unit (Go backend)
- [ ] `internal/config` валидация env.
- [ ] handlers `GET/PUT /settings` — диапазоны лимитов, `pace_min <= pace_max`, default seed.
- [ ] handlers `POST /runs/start` / `POST /runs/stop` — lifecycle run-сессии.
- [ ] handlers `POST /candidates` — фильтрация по processed + daily/run лимит.
- [ ] handlers `POST /attempts/start` — `attempting` не даёт повторно кликнуть вакансию.
- [ ] handlers `POST /vacancies/result` — запись в `processed_vacancies` + counter инкремент.
- [ ] `cover_letter_guard` (regex + длина).
- [ ] Telegram outbox dispatcher (с fake telegram client).

### Integration (Go backend)
- [ ] Real Postgres через `dockertest` или схема с миграциями: `processed_vacancies` идемпотентность.
- [ ] Crash recovery: вакансия со статусом `attempting` не возвращается в allow-list, пока владелец вручную не решит её статус.
- [ ] LLM через mock провайдер.

### Unit (extension)
- [ ] DOM parser тестируется на сохранённых sanitized HTML fixtures из hh.ru выдачи и страницы вакансии.
- [ ] State machine тестируется без реального hh.ru: idle/running/paused/stop/continue/run limit.

### Manual (extension + backend)
- [ ] DOM селекторы: одна сессия в день, проверить что 10 случайных вакансий выдачи парсятся корректно.
- [ ] Dry-run режим: `POST /candidates` и навигация по карточкам без кликов, сверить allow/skip причины.
- [ ] CAPTCHA path: попросить hh.ru показать капчу через многократные клики (на свой страх) — убедиться что детект работает.
- [ ] Login lost: разлогиниться в hh.ru на лету, нажать Start — должно быть `paused_unknown` с алертом.
- [ ] Cover letter: 1 вакансия с обязательным письмом, end-to-end approve.

### Что НЕ тестируется автоматически
- [ ] Реальные клики в Chrome — это manual smoke на каждой версии. Не пытаемся гонять Playwright против hh.ru.

---

## 15. Дополнительно для точной разработки через code-agent

### 15.1 Пограничные случаи, которые нужно явно держать в дизайне

- [ ] **MV3 service worker может заснуть.** Нельзя держать критичное состояние только в памяти background worker. `run_id`, counters, pause reason и settings snapshot живут в backend/Postgres; background после пробуждения восстанавливается через backend.
- [ ] **Только одна активная вкладка/run.** При `POST /runs/start` backend отклоняет новый run, если уже есть `running/paused_*`. Popup должен показать активный run и дать Stop/Continue.
- [ ] **Пользователь закрыл вкладку или ушёл со страницы.** Extension ставит run в `paused_unknown`/`stopped`, не продолжает клики в другой вкладке без явного Start.
- [ ] **Одно резюме, автовыбор.** Аккаунт владельца содержит одно (дефолтное) резюме. Если HH всё равно показывает модал выбора резюме — это `manual_action` + chrome notification; расширение не угадывает резюме автоматически.
- [ ] **Статус после клика неизвестен.** Если был `attempting`, но success не подтверждён из-за navigation error/service worker sleep/tab close, вакансия становится `unknown_after_click` и больше не кликается автоматически. Владелец разрешает статус вручную через popup (§6.5).
- [ ] **Пагинация — автопереход на следующую страницу.** После исчерпания текущей страницы background инкрементирует параметр `page` в search_url и переходит (§6.3). Если страниц больше нет — run завершается с reason `no_more_vacancies`.
- [ ] **Только `hh.ru`.** Host permissions: `https://hh.ru/*` и `http://127.0.0.1:8080/*`. Региональные поддомены не включаем. Не расширять до `<all_urls>`.
- [ ] **LLM privacy.** В Groq отправляется текст вакансии и черновик письма — владелец принимает это явно, настраивая `LLM_API_KEY`. API key только в backend, никогда в extension. Режим «без LLM» не является поддерживаемым режимом: вакансии с обязательным письмом при недоступном LLM → `skipped_cover_letter`.
- [ ] **Telegram callback race.** Повторный callback «Отправить/Пропустить» должен быть идемпотентным: первый валидный ответ выигрывает, остальные игнорируются.

### 15.2 Практики, чтобы вайбкодинг меньше ошибался

- [ ] Перед каждым этапом агент пишет короткий acceptance checklist и не закрывает этап, пока он не проверен.
- [ ] Для backend — сначала контракты API и unit-тесты handlers, потом реализация.
- [ ] Для content scripts — сначала чистые функции парсинга DOM + sanitized HTML fixtures, потом интеграция с Chrome APIs.
- [ ] Любой код, который кликает HH UI, появляется только после read-only/dry-run этапа и отдельного manual smoke.
- [ ] Все selector changes идут через `extension/src/shared/selectors.ts` + обновление `docs/selectors.md` с датой проверки.
- [ ] В каждом API response для skip/error возвращается machine-readable `reason`, чтобы popup, логи и тесты не парсили текст.
- [ ] Каждая фаза завершается командами проверки: Go tests, TypeScript build/typecheck, extension build, и ручной smoke там, где автоматизация против hh.ru неуместна.

### 15.3 Принятые решения (закрытые вопросы)

Все решения приняты владельцем — не открывать повторно без веской причины.

1. **Пагинация:** автопереход на следующую страницу (инкремент `page`). Реализация — §6.3.
2. **Резюме:** одно дефолтное резюме в аккаунте. Модал выбора резюме = `manual_action`. Выбор резюме в настройках не нужен.
3. **Лимиты:** `dailyLimit` default 100, max 200; `runLimit` default 25, max 100. Значения в `owner_settings` и `.env.example`.
4. **Домены:** только `https://hh.ru/*`. Региональные поддомены не поддерживаются.
5. **LLM:** текст вакансии отправляется в Groq. Режим «без LLM» — не поддерживается; при недоступности LLM вакансии с письмом → `skipped_cover_letter`.

---

## 16. Правила для code-agent (краткая выжимка)

- [ ] Phase order строгий: Этап 0 → 1 → 2 → ... → 8. Не начинать N+1 пока N не закрыт.
- [ ] Не реализовывать ничего из «красных линий» §0.2 — даже если попросят (fingerprint spoof, CAPTCHA solver, прокси, headless evasion).
- [ ] Не добавлять зависимостей в extension без явного обсуждения. Vanilla TS + DOM, esbuild — всё.
- [ ] Backend listen — только `127.0.0.1`. Если вдруг где-то появится `0.0.0.0` — это баг.
- [ ] Все запросы между extension и backend — с `X-Local-Secret` header. Без него backend возвращает 401.
- [ ] Не трогать DOM-селекторы напрямую в content script — все селекторы через `shared/selectors.ts`, чтобы при поломке hh.ru-вёрстки чинить в одном месте.
- [ ] Не комитить `.env` и `LOCAL_SHARED_SECRET`.
- [ ] При любой ошибке расширения — лучше остановить цикл, чем сделать что-то неожиданное на странице.
- [ ] Cover letter LLM — только на сервере. Никогда из extension.
- [ ] Навигация между страницами из background — только `chrome.tabs.update(tabId, {url})`. Не `window.location`, не `chrome.tabs.create`.
- [ ] `POST /vacancies/result` — идемпотентный. Повторный вызов с тем же `(run_id, vacancy_id)` и terminal-статусом не инкрементирует счётчики второй раз.
- [ ] `settings_snapshot` в `apply_runs` — лимиты и pacing читаются из snapshot, не из живых `owner_settings`, пока run активен.
- [ ] `autoApply=false` — добавлять popup-подтверждение (`CONFIRM_REQUEST` → ответ popup) перед каждым кликом «Откликнуться». Без ответа в течение 5 минут = «Пропустить».
- [ ] Chrome notifications дублируют Telegram для событий `captcha`, `error`, `login_lost` (§10). Для `cover_letter_approval` и `daily_report` — только Telegram.
