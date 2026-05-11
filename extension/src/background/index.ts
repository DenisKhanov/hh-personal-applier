import {
  BackendApiError,
  filterCandidates,
  getTodayStats,
  loadBootstrapSettings,
  startRun,
  type ApplyRun,
  type BootstrapSettings,
  type CandidateItem,
  type CandidateRejection,
  type CandidatesResult
} from "../shared/api";
import { isSearchCandidatesParsedMessage } from "../shared/messages";

chrome.runtime.onInstalled.addListener(() => {
  console.log("HH Personal Applier background service worker installed");
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isSearchCandidatesParsedMessage(message)) {
    return false;
  }

  void handleSearchCandidates(message.pageUrl, message.candidates, sender)
    .then(() => {
      sendResponse({ ok: true });
    })
    .catch((error: unknown) => {
      logBackgroundError("failed to process parsed candidates", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown background error"
      });
    });

  return true;
});

async function handleSearchCandidates(
  pageUrl: string,
  candidates: CandidateItem[],
  sender: chrome.runtime.MessageSender
): Promise<void> {
  console.log("[HH Personal Applier] received parsed candidates", {
    tabId: sender.tab?.id,
    pageUrl,
    count: candidates.length
  });

  if (candidates.length === 0) {
    console.log("[HH Personal Applier] no candidates parsed from search page");
    return;
  }

  const settings = await loadBootstrapSettings();
  const run = await startOrReuseRunningRun(settings, pageUrl);
  const result = await filterCandidates(settings, run.runId, candidates);

  logCandidateDecisions(run, candidates, result);
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
