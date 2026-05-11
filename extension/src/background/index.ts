import {
  BackendApiError,
  filterCandidates,
  getTodayStats,
  loadBootstrapSettings,
  recordCaptchaEvent,
  recordErrorEvent,
  recordLoginLostEvent,
  recordVacancyResult,
  startAttempt,
  startRun,
  stopRun,
  type ApplyRun,
  type BootstrapSettings,
  type CandidateItem,
  type CandidateRejection,
  type CandidatesResult,
  type SafetyEvent
} from "../shared/api";
import {
  SEARCH_PARSE_REQUEST,
  VACANCY_APPLY_SIMPLE_REQUEST,
  isPopupGetStatusMessage,
  isPopupStartRunMessage,
  isPopupStopRunMessage,
  isSearchCandidatesParsedMessage,
  type SearchParseResponseMessage,
  type VacancyApplySimpleResponse
} from "../shared/messages";
import { isHhSearchVacancyUrl } from "../shared/pageGuards";
import { completionReason } from "../shared/runPolicy";
import {
  waitForTabNavigationComplete,
  type TabUpdatedListener
} from "../shared/tabNavigation";

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

let state: WorkerState = {
  phase: "idle",
  message: "Idle"
};
let latestSearchSnapshot: SearchSnapshot | null = null;

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
    sendResponse(publicStatus());
    return false;
  }

  if (isPopupStartRunMessage(message)) {
    void startFromPopup()
      .then(sendResponse)
      .catch((error: unknown) => {
        logBackgroundError("failed to start run", error);
        sendResponse({
          ...publicStatus(),
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
          ...publicStatus(),
          ok: false,
          error: error instanceof Error ? error.message : "Failed to stop run"
        });
      });
    return true;
  }

  return false;
});

async function startFromPopup(): Promise<Record<string, unknown>> {
  if (state.phase === "running" || state.phase === "stopping") {
    return { ...publicStatus(), ok: true };
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
      logBackgroundError("run failed", error);
      state = {
        phase: "idle",
        message: error instanceof Error ? error.message : "Run failed"
      };
    }
  );

  return { ...publicStatus(), ok: true };
}

async function stopFromPopup(): Promise<Record<string, unknown>> {
  const current = state;
  if (current.phase === "idle") {
    return { ...publicStatus(), ok: true };
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

  state = {
    phase: "idle",
    message: "Stopped by owner"
  };
  return { ...publicStatus(), ok: true };
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

  const parsed = await requestSearchCandidates(tabId, searchUrl);
  ensureNotAborted(signal);
  const result = await filterCandidates(settings, run.runId, parsed.candidates);
  logCandidateDecisions(run, parsed.candidates, result);

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

    await processCandidate(settings, run.runId, tabId, candidate, signal);
    commandCount += 1;
  }

  ensureNotAborted(signal);
  const reason = completionReason(result);
  await stopRun(settings, run.runId, reason);
  state = {
    phase: "idle",
    message: `Completed: ${reason}`
  };
}

async function processCandidate(
  settings: BootstrapSettings,
  runId: string,
  tabId: number,
  candidate: CandidateItem,
  signal: AbortSignal
): Promise<void> {
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

  state = {
    ...state,
    message: `Applying ${candidate.vacancyId}`
  };
  const response = await requestVacancyApply(tabId, runId, candidate.vacancyId);
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

  await recordVacancyResult(settings, {
    runId,
    vacancyId: candidate.vacancyId,
    status: response.status,
    vacancyTitle: response.vacancyTitle || candidate.title,
    employerName: response.employerName || candidate.employerName,
    vacancyUrl: candidate.vacancyUrl,
    ...(response.notes === undefined ? {} : { notes: response.notes })
  });

  if (response.status === "unknown_after_click") {
    await recordErrorEvent(settings, {
      runId,
      vacancyId: candidate.vacancyId,
      message: "Unknown state after click",
      details: { notes: response.notes ?? "" }
    });
    await createLocalNotification(
      "HH Personal Applier paused",
      "Unknown vacancy state after click. Resolve manually before continuing."
    );
    throw new SafetyStopError("Paused: unknown vacancy state after click");
  }
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
    if (stats.activeRun !== null && stats.activeRun.status === "running") {
      console.log("[HH Personal Applier] reusing active run", {
        runId: stats.activeRun.runId,
        searchUrl: stats.activeRun.searchUrl
      });
      return stats.activeRun;
    }

    throw error;
  }
}

async function requestSearchCandidates(
  tabId: number,
  pageUrl: string
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
    "content/search.js"
  );
}

async function requestVacancyApply(
  tabId: number,
  runId: string,
  vacancyId: string
): Promise<VacancyApplySimpleResponse> {
  return sendMessageWithInjection<VacancyApplySimpleResponse>(
    tabId,
    {
      type: VACANCY_APPLY_SIMPLE_REQUEST,
      runId,
      vacancyId
    },
    "content/vacancy.js"
  );
}

async function sendMessageWithInjection<T>(
  tabId: number,
  message: unknown,
  file: string
): Promise<T> {
  try {
    return await sendTabMessage<T>(tabId, message);
  } catch (error) {
    if (!isMissingReceiver(error)) {
      throw error;
    }
    await executeScriptFile(tabId, file);
    return sendTabMessage<T>(tabId, message);
  }
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

function publicStatus(): Record<string, unknown> {
  return {
    phase: state.phase,
    message: state.message,
    runId: state.runId ?? null,
    tabId: state.tabId ?? null
  };
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

async function navigateTab(
  tabId: number,
  url: string,
  signal: AbortSignal
): Promise<void> {
  ensureNotAborted(signal);
  await waitForTabNavigationComplete(tabId, url, signal, {
    update: async (targetTabId, targetUrl) => {
      await chrome.tabs.update(targetTabId, { url: targetUrl });
    },
    get: async (targetTabId) => {
      const tab = await chrome.tabs.get(targetTabId);
      return { status: tab.status, url: tab.url };
    },
    addUpdatedListener: (listener: TabUpdatedListener) => {
      chrome.tabs.onUpdated.addListener(listener);
    },
    removeUpdatedListener: (listener: TabUpdatedListener) => {
      chrome.tabs.onUpdated.removeListener(listener);
    },
    setTimeout: (handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs),
    clearTimeout: (timeoutId) => {
      globalThis.clearTimeout(timeoutId as number);
    }
  });
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

function isMissingReceiver(error: unknown): boolean {
  return (
    error instanceof Error &&
    /receiving end does not exist|could not establish connection/i.test(
      error.message
    )
  );
}

function randomPaceMs(settings: ApplyRun["settingsSnapshot"]): number {
  const min = settings.paceMinSeconds * 1000;
  const max = settings.paceMaxSeconds * 1000;
  return Math.floor(min + Math.random() * (max - min + 1));
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
