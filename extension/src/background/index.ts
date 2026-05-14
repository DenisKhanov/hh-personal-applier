import {
  BackendApiError,
  continueRun,
  filterCandidates,
  getCoverLetter,
  getTodayStats,
  loadBootstrapSettings,
  recordCaptchaEvent,
  recordErrorEvent,
  recordLoginLostEvent,
  recordVacancyResult,
  requestCoverLetter,
  startAttempt,
  startRun,
  stopRun,
  type ApplyRun,
  type BootstrapSettings,
  type CandidateItem,
  type CandidateRejection,
  type CandidatesResult,
  type CoverLetter,
  type SafetyEvent
} from "../shared/api";
import {
  SEARCH_PARSE_REQUEST,
  VACANCY_APPLY_SIMPLE_REQUEST,
  VACANCY_SUBMIT_COVER_LETTER_REQUEST,
  isPopupConfirmResponseMessage,
  isPopupContinueRunMessage,
  isPopupGetStatusMessage,
  isPopupStartRunMessage,
  isPopupStopRunMessage,
  isSearchCandidatesParsedMessage,
  type ConfirmDecision,
  type PendingConfirmationView,
  type SearchParseResponseMessage,
  type VacancyApplySimpleResponse
} from "../shared/messages";
import {
  createOwnerConfirmationController,
  type StoredOwnerConfirmation
} from "../shared/ownerConfirmation";
import {
  notificationForContinuableResult,
  shouldNotifyContinuableResult
} from "../shared/applyResultPolicy";
import {
  COVER_LETTER_APPROVAL_TIMEOUT_MS,
  pollCoverLetterApproval as pollCoverLetterApprovalUntilDecision
} from "../shared/coverLetterApproval";
import { isHhSearchVacancyUrl } from "../shared/pageGuards";
import { completionReason } from "../shared/runPolicy";
import { sendMessageWithInjection as sendMessageWithInjectedScript } from "../shared/tabMessaging";
import {
  navigateAndWait,
  waitForTabReady,
  type TabNavigationDeps,
  type TabReadinessSnapshot
} from "../shared/tabNavigation";
import {
  isBackendNetworkError,
  networkSafetyEvent
} from "../shared/networkSafety";
import { nextSearchPageUrl } from "../shared/searchPagination";

type WorkerPhase = "idle" | "running" | "stopping";

interface WorkerState {
  phase: WorkerPhase;
  message: string;
  runId?: string;
  tabId?: number;
  abortController?: AbortController;
}

interface SearchSnapshot {
  tabId?: number;
  pageUrl: string;
  parsedAt: string;
  candidates: CandidateItem[];
}

class AbortRunError extends Error {
  constructor() {
    super("Run aborted");
    this.name = "AbortRunError";
  }
}

class SafetyStopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyStopError";
  }
}

const OWNER_CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1000;
const COVER_LETTER_POLL_MS = 5000;
const PENDING_OWNER_CONFIRMATION_KEY = "pendingOwnerConfirmation";

const ownerConfirmation = createOwnerConfirmationController({
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as number);
  },
  savePending: saveStoredOwnerConfirmation,
  clearPending: clearStoredOwnerConfirmation,
  log(message, data): void {
    console.log(`[HH Personal Applier] ${message}`, data);
  }
});

let state: WorkerState = {
  phase: "idle",
  message: "Idle"
};
let latestSearchSnapshot: SearchSnapshot | null = null;
const llmRateLimitedRuns = new Set<string>();

chrome.runtime.onInstalled.addListener(() => {
  console.log("HH Personal Applier background service worker installed");
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isSearchCandidatesParsedMessage(message)) {
    latestSearchSnapshot = {
      pageUrl: message.pageUrl,
      parsedAt: message.parsedAt,
      candidates: message.candidates,
      ...(sender.tab?.id === undefined ? {} : { tabId: sender.tab.id })
    };
    console.log("[HH Personal Applier] cached parsed search candidates", {
      tabId: sender.tab?.id,
      pageUrl: message.pageUrl,
      count: message.candidates.length
    });
    sendResponse({ ok: true });
    return false;
  }

  if (isPopupGetStatusMessage(message)) {
    void publicStatus()
      .then(sendResponse)
      .catch((error: unknown) => {
        logBackgroundError("failed to get status", error);
        sendResponse(publicStatusSync());
      });
    return true;
  }

  if (isPopupConfirmResponseMessage(message)) {
    const ok = ownerConfirmation.decide(message.vacancyId, message.decision);
    if (ok) {
      sendResponse({ ok: true });
      return false;
    }
    void handleRecoveredConfirmationDecision(message.vacancyId, message.decision)
      .then(sendResponse)
      .catch((error: unknown) => {
        logBackgroundError("failed to handle recovered confirmation", error);
        sendResponse({
          ok: false,
          reason: error instanceof Error ? error.message : "confirmation_failed"
        });
      });
    return true;
  }

  if (isPopupStartRunMessage(message)) {
    void startFromPopup()
      .then(sendResponse)
      .catch((error: unknown) => {
        logBackgroundError("failed to start run", error);
        sendResponse({
          ...publicStatusSync(),
          ok: false,
          error: error instanceof Error ? error.message : "Failed to start run"
        });
      });
    return true;
  }

  if (isPopupStopRunMessage(message)) {
    void stopFromPopup()
      .then(sendResponse)
      .catch((error: unknown) => {
        logBackgroundError("failed to stop run", error);
        sendResponse({
          ...publicStatusSync(),
          ok: false,
          error: error instanceof Error ? error.message : "Failed to stop run"
        });
      });
    return true;
  }

  if (isPopupContinueRunMessage(message)) {
    void continueFromPopup()
      .then(sendResponse)
      .catch((error: unknown) => {
        logBackgroundError("failed to continue run", error);
        sendResponse({
          ...publicStatusSync(),
          ok: false,
          error: error instanceof Error ? error.message : "Failed to continue run"
        });
      });
    return true;
  }

  return false;
});

async function startFromPopup(): Promise<Record<string, unknown>> {
  if (state.phase === "running" || state.phase === "stopping") {
    return { ...publicStatusSync(), ok: true };
  }

  const tab = await activeTab();
  if (tab.id === undefined || tab.url === undefined || !isHhSearchVacancyUrl(tab.url)) {
    throw new Error("Open https://hh.ru/search/vacancy* in the active tab before Start.");
  }

  const settings = await loadBootstrapSettings();
  const abortController = new AbortController();
  state = {
    phase: "running",
    message: "Starting run",
    tabId: tab.id,
    abortController
  };

  void runApplyCycle(settings, tab.id, tab.url, abortController.signal).catch(
    (error: unknown) => {
      if (error instanceof AbortRunError) {
        console.log("[HH Personal Applier] run aborted");
        return;
      }
      if (error instanceof SafetyStopError) {
        state = {
          phase: "idle",
          message: error.message
        };
        return;
      }
      if (isBackendNetworkError(error)) {
        void handleBackendNetworkFailure(settings, error).catch((networkError: unknown) => {
          logBackgroundError("failed to handle backend network safety stop", networkError);
        });
        return;
      }
      logBackgroundError("run failed", error);
      state = {
        phase: "idle",
        message: error instanceof Error ? error.message : "Run failed"
      };
    }
  );

  return { ...publicStatusSync(), ok: true };
}

async function handleBackendNetworkFailure(
  settings: BootstrapSettings,
  error: unknown
): Promise<void> {
  const runId = state.runId;
  state = {
    phase: "idle",
    message: "Paused: backend network request failed after retries",
    ...(runId === undefined ? {} : { runId })
  };

  await createLocalNotification(
    "HH Personal Applier paused",
    "Backend is unreachable after retries. Check the local backend, then continue from popup."
  );

  if (runId === undefined) {
    return;
  }

  try {
    await recordErrorEvent(settings, networkSafetyEvent(runId, error));
  } catch (recordError: unknown) {
    logBackgroundError("failed to record backend network safety stop", recordError);
  }
}

async function stopFromPopup(): Promise<Record<string, unknown>> {
  const current = state;
  if (current.phase === "idle") {
    // Service worker may have restarted — check backend for stale active runs.
    const settings = await loadBootstrapSettings();
    const stats = await getTodayStats(settings);
    if (stats.activeRun !== null) {
      console.log("[HH Personal Applier] stopping stale active run from idle state", {
        runId: stats.activeRun.runId,
        status: stats.activeRun.status
      });
      await stopRun(settings, stats.activeRun.runId, "owner_stop");
      await clearStoredOwnerConfirmation();
      return { ...publicStatusSync(), ok: true };
    }
    await clearStoredOwnerConfirmation();
    return { ...publicStatusSync(), ok: true };
  }

  current.abortController?.abort();
  state = {
    ...current,
    phase: "stopping",
    message: "Stopping"
  };

  if (current.runId !== undefined) {
    const settings = await loadBootstrapSettings();
    await stopRun(settings, current.runId, "owner_stop");
  }
  await clearStoredOwnerConfirmation();

  state = {
    phase: "idle",
    message: "Stopped by owner"
  };
  return { ...publicStatusSync(), ok: true };
}

async function continueFromPopup(): Promise<Record<string, unknown>> {
  const settings = await loadBootstrapSettings();
  const stats = await getTodayStats(settings);
  const activeRun = stats.activeRun;
  if (activeRun === null) {
    return {
      ...publicStatusSync(),
      ok: false,
      error: "No active paused run found."
    };
  }
  if (!isPausedRunStatus(activeRun.status)) {
    return {
      ...publicStatusSync(),
      ok: false,
      error: `Run is not paused: ${activeRun.status}.`
    };
  }

  const run = await continueRun(settings, activeRun.runId);
  state = {
    phase: "idle",
    message: `Continued ${run.runId}; click Start to resume from the active search tab`,
    runId: run.runId
  };
  return { ...publicStatusSync(), ok: true };
}

async function runApplyCycle(
  settings: BootstrapSettings,
  tabId: number,
  searchUrl: string,
  signal: AbortSignal
): Promise<void> {
  const run = await startOrReuseRunningRun(settings, searchUrl);
  state = {
    ...state,
    runId: run.runId,
    message: "Parsing search results"
  };

  let pageUrl = searchUrl;
  let reason: ReturnType<typeof completionReason> = "no_more_vacancies";

  while (true) {
    const pageResult = await processSearchPage(settings, run, tabId, pageUrl, signal);
    reason = pageResult.reason;
    if (reason !== "no_more_vacancies" || pageResult.emptyPage) {
      break;
    }

    pageUrl = nextSearchPageUrl(pageUrl);
    latestSearchSnapshot = null;
    state = {
      ...state,
      message: `Opening next search page ${new URL(pageUrl).searchParams.get("page") ?? ""}`
    };
    await navigateTab(tabId, pageUrl, signal);
  }

  await stopRun(settings, run.runId, reason);
  state = {
    phase: "idle",
    message: `Completed: ${reason}`
  };
}

async function processSearchPage(
  settings: BootstrapSettings,
  run: ApplyRun,
  tabId: number,
  pageUrl: string,
  signal: AbortSignal
): Promise<{ reason: ReturnType<typeof completionReason>; emptyPage: boolean }> {
  state = {
    ...state,
    message: "Parsing search results"
  };

  const parsed = await requestSearchCandidates(tabId, pageUrl, signal);
  ensureNotAborted(signal);

  if (parsed.candidates.length === 0) {
    console.log("[HH Personal Applier] search parser returned 0 candidates — selectors may not match the current hh.ru DOM");
    return { reason: "no_more_vacancies", emptyPage: true };
  }

  const result = await filterCandidates(settings, run.runId, parsed.candidates);
  logCandidateDecisions(run, parsed.candidates, result);

  if (result.allow.length === 0) {
    const reasons = new Map<string, number>();
    for (const rejection of result.rejected) {
      reasons.set(rejection.reason, (reasons.get(rejection.reason) ?? 0) + 1);
    }
    console.log("[HH Personal Applier] all candidates rejected by backend — moving to next search page if limits allow", {
      total: parsed.candidates.length,
      reasons: Object.fromEntries(reasons),
      remainingDaily: result.remainingDaily,
      remainingRun: result.remainingRun
    });
  }

  const candidatesById = new Map(
    parsed.candidates.map((candidate) => [candidate.vacancyId, candidate])
  );

  let commandCount = 0;
  for (const vacancyId of result.allow) {
    ensureNotAborted(signal);
    const candidate = candidatesById.get(vacancyId);
    if (candidate === undefined) {
      continue;
    }

    if (commandCount > 0) {
      state = {
        ...state,
        message: "Pacing before next click"
      };
      await abortableDelay(randomPaceMs(run.settingsSnapshot), signal);
    }

    await processCandidate(settings, run, tabId, candidate, signal);
    commandCount += 1;
  }

  ensureNotAborted(signal);
  return {
    reason: completionReason(result, commandCount),
    emptyPage: false
  };
}

async function processCandidate(
  settings: BootstrapSettings,
  run: ApplyRun,
  tabId: number,
  candidate: CandidateItem,
  signal: AbortSignal
): Promise<void> {
  const runId = run.runId;
  state = {
    ...state,
    message: `Opening ${candidate.vacancyId}`
  };
  await navigateTab(tabId, candidate.vacancyUrl, signal);
  ensureNotAborted(signal);

  const attempt = await startAttempt(settings, {
    runId,
    vacancyId: candidate.vacancyId,
    vacancyTitle: candidate.title,
    employerName: candidate.employerName,
    vacancyUrl: candidate.vacancyUrl
  });
  if (!attempt.started) {
    console.log("[HH Personal Applier] attempt rejected by backend", {
      vacancyId: candidate.vacancyId,
      reason: attempt.reason ?? ""
    });
    return;
  }

  if (run.settingsSnapshot.autoApply === false) {
    state = {
      ...state,
      message: `Awaiting owner confirmation for ${candidate.vacancyId}`
    };
    const decision = await ownerConfirmation
      .request(
        {
          vacancyId: candidate.vacancyId,
          title: candidate.title,
          employer: candidate.employerName,
          url: candidate.vacancyUrl,
          runId,
          tabId
        },
        signal,
        OWNER_CONFIRMATION_TIMEOUT_MS
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new AbortRunError();
        }
        throw error;
      });
    if (decision === "skip") {
      await recordVacancyResult(settings, {
        runId,
        vacancyId: candidate.vacancyId,
        status: "skipped",
        vacancyTitle: candidate.title,
        employerName: candidate.employerName,
        vacancyUrl: candidate.vacancyUrl,
        notes: "owner declined in popup"
      });
      return;
    }
    ensureNotAborted(signal);
  }

  state = {
    ...state,
    message: `Applying ${candidate.vacancyId}`
  };
  const response = await requestVacancyApply(tabId, runId, candidate.vacancyId, signal);
  ensureNotAborted(signal);

  if (!response.ok) {
    await recordVacancyResult(settings, {
      runId,
      vacancyId: candidate.vacancyId,
      status: "error",
      vacancyTitle: response.vacancyTitle || candidate.title,
      employerName: response.employerName || candidate.employerName,
      vacancyUrl: candidate.vacancyUrl,
      notes: response.message
    });
    await recordSafetyStop(settings, runId, candidate.vacancyId, response);
    throw new SafetyStopError(`Paused: ${response.message}`);
  }

  if (response.status === "skipped_cover_letter") {
    await handleCoverLetterFlow(settings, run, tabId, candidate, response, signal);
    return;
  }

  await recordVacancyResult(settings, {
    runId,
    vacancyId: candidate.vacancyId,
    status: response.status,
    vacancyTitle: response.vacancyTitle || candidate.title,
    employerName: response.employerName || candidate.employerName,
    vacancyUrl: candidate.vacancyUrl,
    ...(response.notes === undefined ? {} : { notes: response.notes })
  });

  if (shouldNotifyContinuableResult(response.status)) {
    await recordErrorEvent(
      settings,
      notificationForContinuableResult({
        runId,
        vacancyId: candidate.vacancyId,
        status: response.status,
        vacancyUrl: candidate.vacancyUrl,
        notes: response.notes
      })
    );
    await createLocalNotification(
      "HH Personal Applier",
      `${response.status}: ${candidate.vacancyId}. Continuing.`
    );
  }
}

async function handleCoverLetterFlow(
  settings: BootstrapSettings,
  run: ApplyRun,
  tabId: number,
  candidate: CandidateItem,
  response: Extract<VacancyApplySimpleResponse, { ok: true }>,
  signal: AbortSignal
): Promise<void> {
  const runId = run.runId;
  if (llmRateLimitedRuns.has(runId)) {
    await recordVacancyResult(settings, {
      runId,
      vacancyId: candidate.vacancyId,
      status: "skipped_cover_letter",
      vacancyTitle: response.vacancyTitle || candidate.title,
      employerName: response.employerName || candidate.employerName,
      vacancyUrl: candidate.vacancyUrl,
      notes: "LLM rate limited earlier in this run"
    });
    return;
  }

  state = {
    ...state,
    message: `Generating cover letter for ${candidate.vacancyId}`
  };

  let letter: CoverLetter;
  try {
    letter = await requestCoverLetter(settings, {
      runId,
      vacancyId: candidate.vacancyId,
      vacancyTitle: response.vacancyTitle || candidate.title,
      vacancyDescription:
        response.vacancyDescription?.trim() || candidate.title,
      vacancyUrl: candidate.vacancyUrl
    });
  } catch (error: unknown) {
    if (error instanceof BackendApiError && error.code === "llm_rate_limited") {
      llmRateLimitedRuns.add(runId);
      await recordVacancyResult(settings, {
        runId,
        vacancyId: candidate.vacancyId,
        status: "skipped_cover_letter",
        vacancyTitle: response.vacancyTitle || candidate.title,
        employerName: response.employerName || candidate.employerName,
        vacancyUrl: candidate.vacancyUrl,
        notes: "LLM rate limited"
      });
      return;
    }
    throw error;
  }

  if (letter.status === "pending_approval") {
    state = {
      ...state,
      message: `Waiting for Telegram approval for ${candidate.vacancyId}`
    };
    letter = await pollCoverLetterApproval(settings, candidate.vacancyId, signal);
  }

  if (letter.status === "skipped" || letter.status === "expired") {
    await recordVacancyResult(settings, {
      runId,
      vacancyId: candidate.vacancyId,
      status: "skipped_cover_letter",
      vacancyTitle: response.vacancyTitle || candidate.title,
      employerName: response.employerName || candidate.employerName,
      vacancyUrl: candidate.vacancyUrl,
      notes: `cover letter approval ${letter.status}`
    });
    return;
  }

  if (letter.status !== "approved" || letter.body === undefined || letter.body.trim() === "") {
    await recordVacancyResult(settings, {
      runId,
      vacancyId: candidate.vacancyId,
      status: "error",
      vacancyTitle: response.vacancyTitle || candidate.title,
      employerName: response.employerName || candidate.employerName,
      vacancyUrl: candidate.vacancyUrl,
      notes: "cover letter approval returned no approved body"
    });
    return;
  }

  state = {
    ...state,
    message: `Submitting cover letter for ${candidate.vacancyId}`
  };
  const submitResponse = await requestCoverLetterSubmit(
    tabId,
    runId,
    candidate.vacancyId,
    letter.body,
    signal
  );
  ensureNotAborted(signal);

  if (!submitResponse.ok) {
    await recordVacancyResult(settings, {
      runId,
      vacancyId: candidate.vacancyId,
      status: "error",
      vacancyTitle: submitResponse.vacancyTitle || candidate.title,
      employerName: submitResponse.employerName || candidate.employerName,
      vacancyUrl: candidate.vacancyUrl,
      notes: submitResponse.message
    });
    await recordSafetyStop(settings, runId, candidate.vacancyId, submitResponse);
    throw new SafetyStopError(`Paused: ${submitResponse.message}`);
  }

  await recordVacancyResult(settings, {
    runId,
    vacancyId: candidate.vacancyId,
    status: submitResponse.status,
    vacancyTitle: submitResponse.vacancyTitle || candidate.title,
    employerName: submitResponse.employerName || candidate.employerName,
    vacancyUrl: candidate.vacancyUrl,
    ...(submitResponse.notes === undefined ? {} : { notes: submitResponse.notes })
  });
  if (shouldNotifyContinuableResult(submitResponse.status)) {
    await recordErrorEvent(
      settings,
      notificationForContinuableResult({
        runId,
        vacancyId: candidate.vacancyId,
        status: submitResponse.status,
        vacancyUrl: candidate.vacancyUrl,
        notes: submitResponse.notes
      })
    );
  }
}

async function pollCoverLetterApproval(
  settings: BootstrapSettings,
  vacancyId: string,
  signal: AbortSignal
): Promise<CoverLetter> {
  return pollCoverLetterApprovalUntilDecision(vacancyId, signal, {
    pollMs: COVER_LETTER_POLL_MS,
    timeoutMs: COVER_LETTER_APPROVAL_TIMEOUT_MS,
    getCoverLetter: (id) => getCoverLetter(settings, id),
    delay: abortableDelay
  });
}

async function startOrReuseRunningRun(
  settings: BootstrapSettings,
  pageUrl: string
): Promise<ApplyRun> {
  try {
    return await startRun(settings, pageUrl);
  } catch (error) {
    if (!(error instanceof BackendApiError) || error.code !== "active_run_exists") {
      throw error;
    }

    const stats = await getTodayStats(settings);
    if (stats.activeRun === null) {
      throw error;
    }

    if (stats.activeRun.status === "running") {
      console.log("[HH Personal Applier] reusing active run", {
        runId: stats.activeRun.runId,
        searchUrl: stats.activeRun.searchUrl
      });
      return stats.activeRun;
    }

    // Paused or stale active run — stop it and start fresh.
    console.log("[HH Personal Applier] stopping stale active run before starting new one", {
      runId: stats.activeRun.runId,
      status: stats.activeRun.status
    });
    await stopRun(settings, stats.activeRun.runId, "owner_stop");
    return await startRun(settings, pageUrl);
  }
}

async function requestSearchCandidates(
  tabId: number,
  pageUrl: string,
  signal: AbortSignal
): Promise<SearchParseResponseMessage> {
  if (
    latestSearchSnapshot !== null &&
    latestSearchSnapshot.tabId === tabId &&
    latestSearchSnapshot.pageUrl === pageUrl
  ) {
    return latestSearchSnapshot;
  }

  return sendMessageWithInjection<SearchParseResponseMessage>(
    tabId,
    { type: SEARCH_PARSE_REQUEST },
    "content/search.js",
    signal
  );
}

async function requestVacancyApply(
  tabId: number,
  runId: string,
  vacancyId: string,
  signal: AbortSignal
): Promise<VacancyApplySimpleResponse> {
  return sendMessageWithInjection<VacancyApplySimpleResponse>(
    tabId,
    {
      type: VACANCY_APPLY_SIMPLE_REQUEST,
      runId,
      vacancyId
    },
    "content/vacancy.js",
    signal
  );
}

async function requestCoverLetterSubmit(
  tabId: number,
  runId: string,
  vacancyId: string,
  body: string,
  signal: AbortSignal
): Promise<VacancyApplySimpleResponse> {
  return sendMessageWithInjection<VacancyApplySimpleResponse>(
    tabId,
    {
      type: VACANCY_SUBMIT_COVER_LETTER_REQUEST,
      runId,
      vacancyId,
      body
    },
    "content/vacancy.js",
    signal
  );
}

async function sendMessageWithInjection<T>(
  tabId: number,
  message: unknown,
  file: string,
  signal: AbortSignal
): Promise<T> {
  return sendMessageWithInjectedScript<T>(tabId, message, file, signal, {
    sendTabMessage,
    executeScriptFile,
    waitForTabReady: async (targetTabId, targetSignal) => {
      console.log("[HH Personal Applier] message channel closed — page likely navigated, waiting and retrying");
      await waitForTabReady(targetTabId, targetSignal, tabNavigationDeps);
    },
    ensureNotAborted: () => ensureNotAborted(signal)
  });
}

function logCandidateDecisions(
  run: ApplyRun,
  candidates: CandidateItem[],
  result: CandidatesResult
): void {
  const allowed = new Set(result.allow);
  const rejectedById = new Map<string, CandidateRejection>(
    result.rejected.map((rejection) => [rejection.vacancyId, rejection])
  );

  console.log("[HH Personal Applier] backend candidate filter result", {
    runId: run.runId,
    allow: result.allow.length,
    rejected: result.rejected.length,
    remainingDaily: result.remainingDaily,
    remainingRun: result.remainingRun
  });

  console.table(
    candidates.map((candidate) => {
      const rejected = rejectedById.get(candidate.vacancyId);
      return {
        vacancyId: candidate.vacancyId,
        title: candidate.title,
        employerName: candidate.employerName,
        decision: allowed.has(candidate.vacancyId) ? "allow" : "reject",
        reason: rejected?.reason ?? "",
        status: rejected?.status ?? "",
        hasTest: candidate.hasTest === true,
        isExternal: candidate.isExternal === true,
        isArchived: candidate.isArchived === true,
        requiresLetter: candidate.requiresLetter === true
      };
    })
  );
}

async function recordSafetyStop(
  settings: BootstrapSettings,
  runId: string,
  vacancyId: string,
  response: Extract<VacancyApplySimpleResponse, { ok: false }>
): Promise<void> {
  const event: SafetyEvent = {
    runId,
    vacancyId,
    message: response.message,
    ...(response.details === undefined ? {} : { details: response.details })
  };

  if (response.safety === "captcha") {
    await recordCaptchaEvent(settings, event);
    await createLocalNotification(
      "HH Personal Applier paused",
      "CAPTCHA detected. Solve it manually, then continue from popup."
    );
    return;
  }
  if (response.safety === "login_lost") {
    await recordLoginLostEvent(settings, event);
    await createLocalNotification(
      "HH Personal Applier paused",
      "hh.ru login appears to be lost. Log in manually before continuing."
    );
    return;
  }

  await recordErrorEvent(settings, event);
  await createLocalNotification(
    "HH Personal Applier paused",
    response.message
  );
}

async function publicStatus(): Promise<Record<string, unknown>> {
  const settings = await loadBootstrapSettings();
  const stats = await getTodayStats(settings).catch(() => null);
  return {
    ...publicStatusSync(await pendingConfirmationForStatus()),
    activeRun: stats?.activeRun ?? null
  };
}

function publicStatusSync(
  pendingConfirmation: PendingConfirmationView | null = ownerConfirmation.getPending()
): Record<string, unknown> {
  return {
    phase: state.phase,
    message: state.message,
    runId: state.runId ?? null,
    tabId: state.tabId ?? null,
    pendingConfirmation
  };
}

async function pendingConfirmationForStatus(): Promise<PendingConfirmationView | null> {
  const inMemory = ownerConfirmation.getPending();
  if (inMemory !== null) {
    return inMemory;
  }

  const stored = await loadStoredOwnerConfirmation();
  if (stored === null) {
    return null;
  }

  if (Date.now() < stored.expiresAtMs) {
    return pendingView(stored);
  }

  await applyRecoveredConfirmation(stored, "confirm", {
    timedOut: true
  });
  state = {
    phase: "idle",
    message: `Recovered auto-confirm for ${stored.vacancyId}; run stopped`
  };
  return null;
}

async function handleRecoveredConfirmationDecision(
  vacancyId: string,
  decision: ConfirmDecision
): Promise<Record<string, unknown>> {
  const stored = await loadStoredOwnerConfirmation();
  if (stored === null || stored.vacancyId !== vacancyId) {
    return { ok: false, reason: "no_pending_confirmation" };
  }

  const effectiveDecision: ConfirmDecision =
    Date.now() >= stored.expiresAtMs ? "confirm" : decision;
  return applyRecoveredConfirmation(stored, effectiveDecision, {
    timedOut: Date.now() >= stored.expiresAtMs
  });
}

async function applyRecoveredConfirmation(
  stored: StoredOwnerConfirmation,
  decision: ConfirmDecision,
  options: { timedOut?: boolean } = {}
): Promise<Record<string, unknown>> {
  await clearStoredOwnerConfirmation();
  const settings = await loadBootstrapSettings();

  if (decision === "skip") {
    await recordVacancyResult(settings, {
      runId: stored.runId,
      vacancyId: stored.vacancyId,
      status: "skipped",
      vacancyTitle: stored.title,
      employerName: stored.employer,
      vacancyUrl: stored.url,
      notes: options.timedOut
        ? "owner confirmation expired before skip decision; auto-confirm is required"
        : "owner declined in popup after service worker restart"
    });
    await stopRun(settings, stored.runId, "owner_stop");
    state = {
      phase: "idle",
      message: `Recovered skip for ${stored.vacancyId}; run stopped`
    };
    return { ok: true, recovered: true };
  }

  const signal = new AbortController().signal;
  const response = await requestVacancyApply(
    stored.tabId,
    stored.runId,
    stored.vacancyId,
    signal
  );

  if (!response.ok) {
    await recordVacancyResult(settings, {
      runId: stored.runId,
      vacancyId: stored.vacancyId,
      status: "error",
      vacancyTitle: response.vacancyTitle || stored.title,
      employerName: response.employerName || stored.employer,
      vacancyUrl: stored.url,
      notes: response.message
    });
    await recordSafetyStop(settings, stored.runId, stored.vacancyId, response);
    state = {
      phase: "idle",
      message: `Paused: ${response.message}`
    };
    return { ok: true, recovered: true };
  }

  await recordVacancyResult(settings, {
    runId: stored.runId,
    vacancyId: stored.vacancyId,
    status: response.status,
    vacancyTitle: response.vacancyTitle || stored.title,
    employerName: response.employerName || stored.employer,
    vacancyUrl: stored.url,
    ...(response.notes === undefined ? {} : { notes: response.notes })
  });
  if (shouldNotifyContinuableResult(response.status)) {
    await recordErrorEvent(
      settings,
      notificationForContinuableResult({
        runId: stored.runId,
        vacancyId: stored.vacancyId,
        status: response.status,
        vacancyUrl: stored.url,
        notes: response.notes
      })
    );
  }
  await stopRun(settings, stored.runId, "owner_stop");
  state = {
    phase: "idle",
    message: options.timedOut
      ? `Recovered auto-confirm for ${stored.vacancyId}; run stopped`
      : `Recovered confirmation for ${stored.vacancyId}; run stopped`
  };
  return { ok: true, recovered: true };
}

function pendingView(
  stored: StoredOwnerConfirmation
): PendingConfirmationView {
  return {
    vacancyId: stored.vacancyId,
    title: stored.title,
    employer: stored.employer,
    url: stored.url
  };
}

async function saveStoredOwnerConfirmation(
  record: StoredOwnerConfirmation
): Promise<void> {
  await chrome.storage.local.set({
    [PENDING_OWNER_CONFIRMATION_KEY]: record
  });
}

async function clearStoredOwnerConfirmation(): Promise<void> {
  await chrome.storage.local.remove(PENDING_OWNER_CONFIRMATION_KEY);
}

async function loadStoredOwnerConfirmation(): Promise<StoredOwnerConfirmation | null> {
  const stored = await chrome.storage.local.get(PENDING_OWNER_CONFIRMATION_KEY);
  const value = stored[PENDING_OWNER_CONFIRMATION_KEY];
  return isStoredOwnerConfirmation(value) ? value : null;
}

function isStoredOwnerConfirmation(
  value: unknown
): value is StoredOwnerConfirmation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<StoredOwnerConfirmation>;
  return (
    typeof record.vacancyId === "string" &&
    typeof record.title === "string" &&
    typeof record.employer === "string" &&
    typeof record.url === "string" &&
    typeof record.runId === "string" &&
    typeof record.tabId === "number" &&
    typeof record.createdAtMs === "number" &&
    typeof record.expiresAtMs === "number"
  );
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  const tab = tabs[0];
  if (tab === undefined) {
    throw new Error("No active tab found.");
  }
  return tab;
}

const tabNavigationDeps: TabNavigationDeps = {
  async update(tabId: number, url: string): Promise<void> {
    await chrome.tabs.update(tabId, { url });
  },
  async probeReadiness(tabId: number): Promise<TabReadinessSnapshot | null> {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          readyState: document.readyState as
            | "loading"
            | "interactive"
            | "complete",
          href: location.href
        })
      });
      const value = results[0]?.result;
      if (value === undefined || value === null) {
        return null;
      }
      return value;
    } catch {
      // Transient: frame teardown, "cannot access contents of url",
      // "no frame with id" — caller retries.
      return null;
    }
  },
  async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) =>
      globalThis.setTimeout(resolve, ms)
    );
  },
  log(message: string, data: Record<string, unknown>): void {
    console.log(`[HH Personal Applier] ${message}`, data);
  }
};

async function navigateTab(
  tabId: number,
  url: string,
  signal: AbortSignal
): Promise<void> {
  ensureNotAborted(signal);
  await navigateAndWait(tabId, url, signal, tabNavigationDeps);
}

function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      const error = chrome.runtime.lastError;
      if (error !== undefined) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function executeScriptFile(tabId: number, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: [file]
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error !== undefined) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      }
    );
  });
}

function randomPaceMs(settings: ApplyRun["settingsSnapshot"]): number {
  const min = settings.paceMinSeconds * 1000;
  const max = settings.paceMaxSeconds * 1000;
  return Math.floor(min + Math.random() * (max - min + 1));
}

function isPausedRunStatus(status: ApplyRun["status"]): boolean {
  return (
    status === "paused_captcha" ||
    status === "paused_unknown" ||
    status === "paused_network"
  );
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  ensureNotAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      globalThis.clearTimeout(timeout);
      reject(new AbortRunError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AbortRunError();
  }
}

async function createLocalNotification(
  title: string,
  message: string
): Promise<void> {
  await chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("popup/icon.png"),
    title,
    message
  });
}

function logBackgroundError(context: string, error: unknown): void {
  if (error instanceof BackendApiError) {
    console.log(`[HH Personal Applier] ${context}`, {
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
      details: error.details
    });
    return;
  }

  console.log(
    `[HH Personal Applier] ${context}`,
    error instanceof Error ? error.message : error
  );
}
