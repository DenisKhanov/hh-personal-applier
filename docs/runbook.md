# Runbook

Operational runbook for CAPTCHA, login loss, DOM mismatch, unknown modal, and recovery flows will be filled as the corresponding stages are implemented.

## Owner confirmation (autoApply=false)

When `owner_settings.auto_apply = false` (the pipeline default), the background
worker waits for the owner to click Подтвердить / Пропустить in the popup before
every `Откликнуться` click. The wait timeout is 30 seconds; on timeout the
decision is treated as Подтвердить and the cycle continues.

### MV3 worker dormancy recovery

MV3 service workers go dormant when idle. The pending-confirmation state lives
in memory while the worker is alive and is also mirrored into
`chrome.storage.local`. The storage record includes `runId`, `tabId`,
vacancy data, and an expiry timestamp.

Normal path: keep the popup open while a confirmation is pending. The 1.5 s
status poll keeps the worker alive, the 30-second timeout auto-confirms, and the
cycle moves to the next vacancy after the click result is recorded.

Recovery path: if Chrome evicts the worker before the owner responds, reopening
the popup restores the pending card from storage. If the record is already
expired, the background worker treats it as auto-confirm, applies that one
decision, records the result, clears the pending state, and stops the stale run.
If the owner confirms or skips a restored pending card before expiry, the
background worker applies that one decision, records the result, clears the
pending state, and stops the stale run. Start again from the search page to
continue with a fresh worker loop.

### Stage 7 reminder

Cover-letter approval (`requireCoverLetterApproval=true`) is a separate flow
through Telegram (§9). The popup-confirmation step described above is for
`autoApply=false` only and runs before the click; cover-letter approval runs
after the click on the response page. The two can compose: Telegram approval
first, then popup-confirm-click.
