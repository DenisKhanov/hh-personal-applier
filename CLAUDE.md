# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project: HH Personal Applier (Chrome extension)

The sections above are general. The sections below are this project's rules.

## 5. Source Of Truth

- Product/engineering source of truth: **`Pipeline_razrabotki_browser_extension.md`**.
- Project rules (mirrored, applies to Claude as well as Codex): **`AGENTS.md`**.
  Read it in full and follow it. It covers:
  - Stage discipline (Этап 0 → 8 strict ordering)
  - Red lines (no anti-detection, no CAPTCHA solving, no proxies, no
    redistribution, single-user only)
  - Extension architecture rules (MV3, manifest permissions, vanilla TS, no
    runtime deps)
  - Local backend rules (`127.0.0.1:8080` only, `X-Local-Secret`)
  - Browser-side flow rules (pacing, two-phase write through UI, safety stops)
  - Telegram rules (outbox, owner-only callbacks, daily report at 23:55)
  - Database rules (4 tables, `CHECK` constraints, no `user_id`)
  - LLM cover letters rules (LLM only on backend, approval via Telegram)
  - Testing, logging, secrets
- If `AGENTS.md` and the pipeline conflict, the **pipeline wins**; afterwards
  update both AGENTS.md and CLAUDE.md.
- This project is **not** a continuation of `AutoApply AI` (frozen at
  `v0.1.0-api-frozen` after HH closed the applicant API on 2025-12-15).
  Treat references to that project as historical context only. Concepts can
  be ported (LLM cover letter guard, Telegram outbox shape, slog setup); no
  code, schema, or behavior carries over by default.

## 6. Stage Discipline

- The pipeline defines **Этапы 0 → 8** with strict ordering. Do not start
  stage N+1 before stage N's Definition of Done is met.
- Out of scope by default: web dashboard (Next.js/React), employer chats,
  multi-user/billing, headless browser automation, scheduled background runs,
  scraping outside the active hh.ru tab. Confirm before introducing any of
  them.
- The red lines in `AGENTS.md` are not negotiable inside this project. If a
  task seems to require crossing them (CAPTCHA solving, anti-detection,
  proxies, public distribution), stop and surface the conflict — do not
  rationalize a workaround.

## 7. Communication

- The user converses in Russian; reply in Russian unless he switches.
- End-of-turn summary: 1–2 sentences. What changed and what's next.
- State results and decisions directly. Do not narrate internal deliberation.

## 8. Tool Selection And Skills

Tool selection:

- Prefer `Edit`/`Read`/`Write` for files. Reserve `Bash` for shell-only
  operations.
- `TaskCreate` only for tasks with 3+ truly discrete sequential steps.
  Conversational spec-editing does not qualify.
- For deferred tools listed in system reminders, call `ToolSearch` first to
  load the schema.

Project-relevant skills (invoke via `Skill` when triggered):

- **Refactor / cleanup:** `simplify`.
- **Pre-completion review:** `superpowers:requesting-code-review`,
  `superpowers:verification-before-completion`.
- **Extension manual smoke:** human-in-the-loop in the owner's Chrome.
  `agent-browser` is **not** to be used against `hh.ru`. It may be used
  against the popup or a synthetic local fixture page only.

MCP servers:

- **`context7`** — preferred over web search for library docs (Chrome
  Extensions MV3, huma, telebot.v3, golang-migrate, pgx).

## 9. Memory System

- File-based memory at
  `/home/denis/.claude/projects/-mnt-ForAllOS-YD-GoProjects-Commercial-hh-personal-applier/memory/`.
- Save memories of types `user`, `feedback`, `project`, `reference` per the
  auto-memory rules.
- Do not memorize project structure, file paths, code patterns, or git history
  — all derivable. AGENTS.md and the pipeline cover them statically.
- A memory naming a function/file/flag is a claim it existed when written.
  Verify with grep/Read before recommending action based on it.
- Memory from the predecessor `AutoApply AI` project (notably entries about
  HH applicant API, OAuth flows, `POST /negotiations` safety) is mostly
  obsolete here. When such memory surfaces, validate against the current
  pipeline before applying.

## 10. Git And Repo Specifics

- A remote repository for this project does not yet exist. Do not run
  `git init` or create a remote without explicit instruction.
- When created, the default branch will be `main`.
- Do not commit, push, or create PRs unless the user explicitly asks. One
  authorization does not extend to subsequent commits — reconfirm.
- For destructive or hard-to-reverse actions (`git reset --hard`, force push,
  dropping data, deleting branches), always ask first.
- Do not bypass hooks (`--no-verify`), skip CI, or downgrade dependencies as a
  shortcut around an obstacle. Diagnose the root cause first.

## 11. Verification Before Declaring Done

- After substantive code edits, run the formatter and relevant unit tests
  before declaring complete (see "Testing And Verification" in `AGENTS.md`).
- Backend: `go fmt`, `go vet`, `go test ./...`. Extension: `tsc --noEmit`.
- For extension UI changes, the only honest verification is loading the
  built extension into the owner's Chrome via Developer mode and exercising
  the popup. The agent cannot do this. State explicitly when verification
  was not run, rather than claiming success.
- Automated browser tests against `hh.ru` are forbidden (red line in
  `AGENTS.md`). Smoke against hh.ru is manual, owner-driven only.
- Call `advisor()` before committing to a non-trivial implementation approach
  and before declaring complex work complete.
