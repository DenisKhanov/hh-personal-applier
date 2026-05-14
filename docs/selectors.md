# HH Selectors

Selector map for `hh.ru` DOM parsing.

Last checked: 2026-05-12.

Manual smoke in the owner's logged-in Chrome is still required after every HH DOM change report because markup can vary by auth state, region, and A/B bucket.

## Search Results: `https://hh.ru/search/vacancy*`

| Purpose | Selector / signal | Notes |
|---|---|---|
| Results container | `[data-qa="vacancy-serp__results"]` | Parser scopes cards to this container when present. |
| Vacancy card | `[data-qa="vacancy-serp__vacancy"]` | Stable `data-qa` marker observed in SERP cards. |
| Vacancy title link | `a[data-qa="serp-item__title"]` | `href` carries `/vacancy/{id}`. |
| Vacancy title text | `[data-qa="serp-item__title-text"]` | Preferred source for `title`; falls back to link text. |
| Employer text | `[data-qa="vacancy-serp__vacancy-employer-text"]` | Preferred source for `employerName`. |
| Employer link fallback | `[data-qa="vacancy-serp__vacancy-employer"]` | Used if the text span is absent. |
| Apply response link | `[data-qa="vacancy-serp__vacancy_response"]` | Read-only on search pages. Stage 5 clicks only on vacancy pages. |
| Test marker | `[data-qa*="test"], [data-qa*="question"]` or visible text `тестовое задание` / `вопросы работодателя` | Backend rejects when `skipWithTest=true`. |
| External apply | Response text `Откликнуться на сайте компании`, non-`hh.ru` response URL, or `responseUrl` / `response_url` query signal | No click. |
| Archived | `[data-qa*="archiv"], [data-qa*="archive"]` or visible text `Вакансия в архиве` | Parser supports edge pages and fixtures. |
| Requires letter | `[data-qa*="cover-letter"], [data-qa*="letter"], [data-qa*="soprovod"]` or visible text `Сопроводительное письмо обязательное` | Usually confirmed after opening/clicking the vacancy page. |

## Vacancy Page: `https://hh.ru/vacancy/*`

| Purpose | Selector / signal | Notes |
|---|---|---|
| Title | `[data-qa="vacancy-title"]` | Cached in `processed_vacancies`. |
| Employer | `[data-qa="vacancy-company-name"]` | Cached in `processed_vacancies`. |
| Description | `[data-qa="vacancy-description"], [data-qa="vacancy-section-description"], [data-qa*="vacancy-description"]` | Sent to backend for cover-letter generation. |
| Apply button | `[data-qa="vacancy-response-link-top"], [data-qa="vacancy-response-link-bottom"]` | Clicked only after `/attempts/start`. |
| Response popup | `[data-qa*="vacancy-response-popup"]`, `[role="dialog"]`, or `.bloko-modal` with response/resume text | Known response flow. |
| Response submit button | `[data-qa="vacancy-response-submit-popup"]`, `[data-qa*="vacancy-response-submit"]`, `[data-qa*="response-submit"]`, or enabled button text `Откликнуться` / `Отправить отклик` / `Подтвердить` | Clicked only inside a known response popup. |
| Success | `[data-qa*="vacancy-response-success"], [data-qa*="response-success"]` or visible text `Отклик отправлен` / `Вы откликнулись` | Already-applied text is classified before generic success. |
| CAPTCHA | `[data-qa*="captcha"], form[action*="captcha"], iframe[src*="captcha"]` | Safety stop: `/events/captcha`. |
| Login lost | No apply button plus `[data-qa="login"]` or `[data-qa="mainmenu_profile-link"]` | Safety stop: `/events/login_lost`. |
| Required cover letter | Required letter field markers or visible text `Сопроводительное письмо обязательное` / `Требуется сопроводительное письмо` | Backend LLM + Telegram approval required before submit. |
| Cover letter input | `[data-qa="vacancy-response-popup-form-letter-input"], textarea[name*="letter"], textarea[id*="letter"]` | Filled only after approved cover letter. |
| Archived | `[data-qa*="archiv"], [data-qa*="archive"]` or visible text `Вакансия в архиве` | Records `skipped_archived`. |
| Already applied | Visible text `Вы уже откликались` / `Отклик уже отправлен` | Records `skipped_already_applied`. |
| Test/questions | `[data-qa*="response-test"], [data-qa*="test-required"]` or visible text `тестовое задание` / `вопросы работодателя` | Records `skipped_test` or `manual_action` depending on page shape. |
| Unknown modal | `[role="dialog"], [data-qa*="popup"], .bloko-modal` with non-empty visible text and no known response submit / required-letter / test signal | Safety stop: `/events/error`. |
