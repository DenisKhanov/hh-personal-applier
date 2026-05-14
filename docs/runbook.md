# Runbook

Operational runbook for local recovery flows.

## Owner Confirmation (`autoApply=false`)

When `owner_settings.auto_apply = false`, the background worker waits for the owner to click `Подтвердить` or `Пропустить` in the popup before every `Откликнуться` click.

The pending confirmation is stored in memory and mirrored into `chrome.storage.local` with `runId`, `tabId`, vacancy data, and expiry timestamp. If the MV3 worker is evicted, reopening the popup restores the pending card. Expired pending confirmations are treated as auto-confirm, the one recovered decision is applied, and the stale run is stopped.

## Safety Stops

- CAPTCHA: solve manually in the same browser session, then click Continue in the popup.
- Login lost: log in manually on `hh.ru`, then click Continue.
- Unknown modal / DOM mismatch: inspect the active tab, update selectors if needed, then continue only when the page state is understood.
- Backend network failure: restart/check the local backend on `127.0.0.1:8080`, then continue from the popup if the run was recorded as paused.

## Cover Letters

Cover-letter approval runs through Telegram. The extension submits a generated cover letter only after backend returns `approved`; skipped or expired approvals are recorded as `skipped_cover_letter`.
