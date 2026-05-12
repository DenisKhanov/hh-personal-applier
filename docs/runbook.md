# Runbook

Operational runbook for CAPTCHA, login loss, DOM mismatch, unknown modal, and recovery flows will be filled as the corresponding stages are implemented.

## Owner confirmation (autoApply=false)

When `owner_settings.auto_apply = false` (the pipeline default), the background
worker waits for the owner to click Подтвердить / Пропустить in the popup before
every `Откликнуться` click. The wait timeout is 5 minutes; on timeout the
vacancy is recorded as `skipped` and the cycle moves on.

### MV3 worker dormancy recovery

MV3 service workers go dormant when idle. The pending-confirmation state lives
in memory while the worker is alive and is also mirrored into
`chrome.storage.local`. The storage record includes `runId`, `tabId`,
vacancy data, and an expiry timestamp.

Normal path: keep the popup open while a confirmation is pending. The 1.5 s
status poll keeps the worker alive, the 5-minute timeout records `skipped`, and
the cycle moves to the next vacancy.

Recovery path: if Chrome evicts the worker before the owner responds, reopening
the popup restores the pending card from storage. If the record is already
expired, the background worker records the vacancy as `skipped`, clears the
pending state, and stops the stale run with `owner_stop` so there is no
unresolved `attempting` row. If the owner confirms or skips a restored pending
card before expiry, the background worker applies that one decision, records the
result, clears the pending state, and stops the stale run. Start again from the
search page to continue with a fresh worker loop.

### Stage 7 reminder

Cover-letter approval (`requireCoverLetterApproval=true`) is a separate flow
through Telegram (§9). The popup-confirmation step described above is for
`autoApply=false` only and runs before the click; cover-letter approval runs
after the click on the response page. The two can compose: Telegram approval
first, then popup-confirm-click.
