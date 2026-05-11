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
