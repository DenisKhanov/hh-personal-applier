# HH Selectors

Selector map for `hh.ru` DOM parsing.

Last checked: 2026-05-10.

Check source: public HTML GET of `https://hh.ru/search/vacancy?area=1&text=go`
and spot checks for query pages with `тестовое задание` / `архив`. Final
confirmation still requires the owner's logged-in Chrome dry-run because HH can
vary markup by auth state, region, and A/B bucket.

## Search Results: `https://hh.ru/search/vacancy*`

| Purpose | Selector / signal | Notes |
|---|---|---|
| Results container | `[data-qa="vacancy-serp__results"]` | Parser scopes cards to this container when present. |
| Vacancy card | `[data-qa="vacancy-serp__vacancy"]` | Stable `data-qa` marker observed in SERP cards. |
| Vacancy title link | `a[data-qa="serp-item__title"]` | `href` carries `/vacancy/{id}`. Can be absolute or relative. |
| Vacancy title text | `[data-qa="serp-item__title-text"]` | Preferred source for `title`; falls back to title link text. |
| Vacancy id | Numeric nested element `id`, `/vacancy/{id}`, or `vacancyId` query param | Current cards include a nested numeric `id`; URL extraction is fallback. |
| Employer text | `[data-qa="vacancy-serp__vacancy-employer-text"]` | Preferred source for `employerName`. |
| Employer link fallback | `[data-qa="vacancy-serp__vacancy-employer"]` | Used if the text span is absent. |
| Apply response link | `[data-qa="vacancy-serp__vacancy_response"]` | Read-only in Stage 4. Used only to detect external-response signals. |
| Test marker | `[data-qa*="test"], [data-qa*="question"]` or text `тестовое задание` / `вопросы работодателя` | Query spot check did not expose a stable test-only marker in all cards; keep text fallback narrow. |
| External apply | Response text `Откликнуться на сайте компании`, non-`hh.ru` response URL, or `responseUrl` / `response_url` query signal | No click. Backend can reject as `external`. |
| Archived | `[data-qa*="archiv"], [data-qa*="archive"]` or text `Вакансия в архиве` | Search pages usually hide archived vacancies; parser supports the signal for fixtures and edge pages. |
| Requires letter | `[data-qa*="cover-letter"], [data-qa*="letter"], [data-qa*="soprovod"]` or text `Сопроводительное письмо обязательное` | In observed SERP HTML this is not consistently available before opening/clicking. Stage 4 reports `false` unless the card exposes this signal. |

## Stage Boundaries

- Stage 4 content script reads these selectors only and sends parsed candidates
  to the background worker.
- Stage 4 must not click `[data-qa="vacancy-serp__vacancy_response"]`.
- Stage 4 must not add vacancy-page selectors; `content/vacancy.ts` starts in
  Stage 5.

## Vacancy Page: `https://hh.ru/vacancy/*`

Last checked: 2026-05-11 via public HTML GET of
`https://hh.ru/vacancy/132450705`. Logged-in markup still needs manual smoke
because response modals are auth-dependent.

| Purpose | Selector / signal | Notes |
|---|---|---|
| Title | `[data-qa="vacancy-title"]` | Cached into `/vacancies/result` if content page exposes it. |
| Employer | `[data-qa="vacancy-company-name"]` | Cached into `/vacancies/result`. |
| Apply button | `[data-qa="vacancy-response-link-top"], [data-qa="vacancy-response-link-bottom"]` | Clicked only by `content/vacancy.ts` after background records `/attempts/start`. |
| Response popup | `[data-qa*="vacancy-response-popup"]`, `[role="dialog"]`, or `.bloko-modal` with visible response/resume text | Normal Stage 5 second step after the first vacancy-page click. |
| Response submit button | `[data-qa="vacancy-response-submit-popup"]`, `[data-qa*="vacancy-response-submit"]`, `[data-qa*="response-submit"]`, or enabled button text `Откликнуться` / `Отправить отклик` / `Подтвердить` inside response popup | Clicked only inside a known response popup. No resume choice is made by the extension. |
| Disabled response submit / resume choice | Known response popup is visible, but no enabled response submit button is available | Records `manual_action`; Stage 5 does not choose a resume automatically. |
| Success | `[data-qa*="vacancy-response-success"], [data-qa*="response-success"]` or visible text `Отклик отправлен` / `Вы откликнулись` | Text scan excludes `script`, `style`, `template`, and hidden nodes to avoid translation bundle false positives. |
| CAPTCHA | `[data-qa*="captcha"], form[action*="captcha"], iframe[src*="captcha"]` | Safety stop: `/events/captcha` + local Chrome notification. |
| Login lost | No apply button plus `[data-qa="login"]` or `[data-qa="mainmenu_profile-link"]` | Safety stop: `/events/login_lost` + local Chrome notification. |
| Required cover letter | `[data-qa="vacancy-response-popup-form-letter-input"][required]`, `[data-qa="vacancy-response-popup-form-letter-input"][aria-required="true"]`, required letter field markers, or visible text `Сопроводительное письмо обязательное` / `Требуется сопроводительное письмо` | Optional cover-letter textarea in the normal response popup is not enough to skip. Stage 5 records `skipped_cover_letter` only for mandatory letters; LLM approval starts in Stage 7. |
| Archived | `[data-qa*="archiv"], [data-qa*="archive"]` or visible text `Вакансия в архиве` | Records `skipped_archived`. |
| Already applied | Visible text `Вы уже откликались` / `Отклик уже отправлен` | Records `skipped_already_applied`. |
| Test/questions | `[data-qa*="response-test"], [data-qa*="test-required"]` or visible text `тестовое задание` / `вопросы работодателя` | Records `skipped_test`. |
| Unknown modal | `[role="dialog"], [data-qa*="popup"], .bloko-modal` with non-empty visible text and no known response submit / required-letter / test signal | Records `unknown_after_click`, pauses through `/events/error`. |
