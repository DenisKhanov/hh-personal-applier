import {
  checkBackendHealth,
  getSettings,
  getTodayStats,
  loadBootstrapSettings,
  recordVacancyResult,
  saveBootstrapSettings,
  sendTelegramTest,
  updateSettings,
  type OwnerSettings,
  type ProcessedVacancy,
  type BootstrapSettings,
  type VacancyResultStatus
} from "../shared/api";
import {
  POPUP_CONFIRM_RESPONSE,
  POPUP_CONTINUE_RUN,
  POPUP_GET_STATUS,
  POPUP_START_RUN,
  POPUP_STOP_RUN,
  type ConfirmDecision,
  type PendingConfirmationView
} from "../shared/messages";

const backendUrlInput = query<HTMLInputElement>("#backendUrl");
const sharedSecretInput = query<HTMLInputElement>("#sharedSecret");
const saveButton = query<HTMLButtonElement>("#saveButton");
const healthButton = query<HTMLButtonElement>("#healthButton");
const telegramTestButton = query<HTMLButtonElement>("#telegramTestButton");
const startButton = query<HTMLButtonElement>("#startButton");
const continueButton = query<HTMLButtonElement>("#continueButton");
const stopButton = query<HTMLButtonElement>("#stopButton");
const refreshButton = query<HTMLButtonElement>("#refreshButton");
const saveOwnerSettingsButton = query<HTMLButtonElement>("#saveOwnerSettingsButton");
const statusBadge = query<HTMLElement>("#statusBadge");
const message = query<HTMLElement>("#message");
const runStatus = query<HTMLElement>("#runStatus");
const runStateBadge = query<HTMLElement>("#runStateBadge");
const appliedCount = query<HTMLElement>("#appliedCount");
const skippedCount = query<HTMLElement>("#skippedCount");
const errorCount = query<HTMLElement>("#errorCount");
const remainingCount = query<HTMLElement>("#remainingCount");
const recentList = query<HTMLOListElement>("#recentList");
const dailyLimitInput = query<HTMLInputElement>("#dailyLimit");
const runLimitInput = query<HTMLInputElement>("#runLimit");
const paceMinInput = query<HTMLInputElement>("#paceMinSeconds");
const paceMaxInput = query<HTMLInputElement>("#paceMaxSeconds");
const skipWithTestInput = query<HTMLInputElement>("#skipWithTest");
const skipExternalInput = query<HTMLInputElement>("#skipExternal");
const requireCoverLetterApprovalInput = query<HTMLInputElement>(
  "#requireCoverLetterApproval"
);
const autoApplyInput = query<HTMLInputElement>("#autoApply");
const confirmPanel = query<HTMLElement>("#confirmPanel");
const confirmTitle = query<HTMLElement>("#confirmTitle");
const confirmEmployer = query<HTMLElement>("#confirmEmployer");
const confirmLink = query<HTMLAnchorElement>("#confirmLink");
const confirmButton = query<HTMLButtonElement>("#confirmButton");
const skipButton = query<HTMLButtonElement>("#skipButton");

let lastPendingVacancyId: string | null = null;

void initialize();

async function initialize(): Promise<void> {
  const settings = await loadBootstrapSettings();
  backendUrlInput.value = settings.localBackendUrl;
  sharedSecretInput.value = settings.localSharedSecret;

  saveButton.addEventListener("click", () => {
    void saveCurrentSettings();
  });

  healthButton.addEventListener("click", () => {
    void runHealthCheck();
  });

  telegramTestButton.addEventListener("click", () => {
    void sendTelegramTestFromPopup();
  });

  startButton.addEventListener("click", () => {
    void startRunFromPopup();
  });

  stopButton.addEventListener("click", () => {
    void stopRunFromPopup();
  });

  continueButton.addEventListener("click", () => {
    void continueRunFromPopup();
  });

  refreshButton.addEventListener("click", () => {
    void refreshDashboard();
  });

  saveOwnerSettingsButton.addEventListener("click", () => {
    void saveOwnerSettingsFromPopup();
  });

  confirmButton.addEventListener("click", () => {
    void sendConfirmDecision("confirm");
  });

  skipButton.addEventListener("click", () => {
    void sendConfirmDecision("skip");
  });

  await refreshRunStatus();
  await refreshDashboard();
}

async function sendConfirmDecision(decision: ConfirmDecision): Promise<void> {
  if (lastPendingVacancyId === null) return;
  confirmButton.disabled = true;
  skipButton.disabled = true;
  try {
    await sendRuntimeMessage({
      type: POPUP_CONFIRM_RESPONSE,
      vacancyId: lastPendingVacancyId,
      decision
    });
    await refreshRunStatus();
  } finally {
    confirmButton.disabled = false;
    skipButton.disabled = false;
  }
}

async function saveCurrentSettings(): Promise<void> {
  await saveBootstrapSettings(readSettings());
  setStatus("idle", "Saved");
  message.textContent = "Bootstrap settings saved locally.";
  await refreshDashboard();
}

async function sendTelegramTestFromPopup(): Promise<void> {
  setStatus("checking", "Sending");
  message.textContent = "Queueing Telegram test greeting...";
  telegramTestButton.disabled = true;

  try {
    const settings = readSettings();
    await saveBootstrapSettings(settings);
    const result = await sendTelegramTest(settings);
    if (result.queued) {
      setStatus("ok", "Queued");
      message.textContent =
        "Telegram test greeting queued. It should arrive in a few seconds.";
    } else {
      setStatus("error", "Failed");
      message.textContent = "Backend did not queue the Telegram test greeting.";
    }
  } catch (error) {
    setStatus("error", "Failed");
    message.textContent =
      error instanceof Error
        ? error.message
        : "Failed to queue Telegram test greeting.";
  } finally {
    telegramTestButton.disabled = false;
  }
}

async function startRunFromPopup(): Promise<void> {
  startButton.disabled = true;
  message.textContent = "Starting run from active hh.ru search tab...";
  try {
    await saveBootstrapSettings(readSettings());
    const response = await sendRuntimeMessage({
      type: POPUP_START_RUN
    });
    renderRunStatus(response);
    message.textContent =
      typeof response.error === "string" ? response.error : "Run started.";
    startStatusPolling();
  } catch (error) {
    message.textContent =
      error instanceof Error ? error.message : "Failed to start run.";
  } finally {
    startButton.disabled = false;
  }
}

async function stopRunFromPopup(): Promise<void> {
  stopButton.disabled = true;
  message.textContent = "Stopping run...";
  try {
    const response = await sendRuntimeMessage({
      type: POPUP_STOP_RUN
    });
    renderRunStatus(response);
    message.textContent =
      typeof response.error === "string" ? response.error : "Run stopped.";
  } catch (error) {
    message.textContent =
      error instanceof Error ? error.message : "Failed to stop run.";
  } finally {
    stopButton.disabled = false;
  }
}

async function continueRunFromPopup(): Promise<void> {
  continueButton.disabled = true;
  message.textContent = "Continuing paused run...";
  try {
    const response = await sendRuntimeMessage({
      type: POPUP_CONTINUE_RUN
    });
    renderRunStatus(response);
    message.textContent =
      typeof response.error === "string" ? response.error : "Run continued.";
    await refreshDashboard();
  } catch (error) {
    message.textContent =
      error instanceof Error ? error.message : "Failed to continue run.";
  } finally {
    continueButton.disabled = false;
  }
}

async function refreshRunStatus(): Promise<void> {
  try {
    const response = await sendRuntimeMessage({
      type: POPUP_GET_STATUS
    });
    renderRunStatus(response);
  } catch {
    runStatus.textContent = "idle: background unavailable";
  }
}

function renderRunStatus(response: Record<string, unknown>): void {
  const phase = typeof response.phase === "string" ? response.phase : "idle";
  const statusMessage =
    typeof response.message === "string" ? response.message : "Idle";
  const activeRun = parseActiveRun(response);
  runStatus.textContent = formatRunStatusText(phase, statusMessage, activeRun);
  const activeStatus = activeRun?.status ?? null;
  renderRunState(phase, activeStatus);
  startButton.disabled = phase === "running" || phase === "stopping";
  stopButton.disabled = phase === "stopping";
  continueButton.disabled =
    activeStatus !== "paused_captcha" &&
    activeStatus !== "paused_unknown" &&
    activeStatus !== "paused_network";
  renderPendingConfirmation(response.pendingConfirmation);
  if (phase === "running" || phase === "stopping") {
    startStatusPolling();
  }
}

async function refreshDashboard(): Promise<void> {
  const settings = readSettings();
  try {
    const [ownerSettings, stats] = await Promise.all([
      getSettings(settings),
      getTodayStats(settings)
    ]);
    renderOwnerSettings(ownerSettings);
    appliedCount.textContent = String(stats.applied);
    skippedCount.textContent = String(stats.skipped);
    errorCount.textContent = String(stats.errors);
    remainingCount.textContent = String(stats.remainingDaily);
    renderRecent(stats.recentVacancies);
    if (stats.activeRun !== null) {
      continueButton.disabled =
        stats.activeRun.status !== "paused_captcha" &&
        stats.activeRun.status !== "paused_unknown" &&
        stats.activeRun.status !== "paused_network";
    }
  } catch (error) {
    message.textContent =
      error instanceof Error ? error.message : "Failed to load dashboard.";
  }
}

async function saveOwnerSettingsFromPopup(): Promise<void> {
  saveOwnerSettingsButton.disabled = true;
  try {
    const settings = readSettings();
    await saveBootstrapSettings(settings);
    const ownerSettings = readOwnerSettings();
    const saved = await updateSettings(settings, ownerSettings);
    renderOwnerSettings(saved);
    message.textContent = "Owner settings saved.";
    await refreshDashboard();
  } catch (error) {
    message.textContent =
      error instanceof Error ? error.message : "Failed to save owner settings.";
  } finally {
    saveOwnerSettingsButton.disabled = false;
  }
}

function renderOwnerSettings(settings: OwnerSettings): void {
  dailyLimitInput.value = String(settings.dailyLimit);
  runLimitInput.value = String(settings.runLimit);
  paceMinInput.value = String(settings.paceMinSeconds);
  paceMaxInput.value = String(settings.paceMaxSeconds);
  skipWithTestInput.checked = settings.skipWithTest;
  skipExternalInput.checked = settings.skipExternal;
  requireCoverLetterApprovalInput.checked = settings.requireCoverLetterApproval;
  autoApplyInput.checked = settings.autoApply;
}

function readOwnerSettings(): OwnerSettings {
  return {
    dailyLimit: readNumber(dailyLimitInput),
    runLimit: readNumber(runLimitInput),
    paceMinSeconds: readNumber(paceMinInput),
    paceMaxSeconds: readNumber(paceMaxInput),
    skipWithTest: skipWithTestInput.checked,
    skipExternal: skipExternalInput.checked,
    requireCoverLetterApproval: requireCoverLetterApprovalInput.checked,
    autoApply: autoApplyInput.checked
  };
}

function renderRecent(items: ProcessedVacancy[]): void {
  recentList.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "recent-meta";
    empty.textContent = "No processed vacancies yet.";
    recentList.append(empty);
    return;
  }

  for (const item of items.slice(0, 10)) {
    const li = document.createElement("li");
    li.className = "recent-item";
    const link = document.createElement("a");
    link.href = item.vacancyUrl || "#";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.vacancyTitle || item.vacancyId;
    const meta = document.createElement("p");
    meta.className = "recent-meta";
    meta.textContent = [
      item.status,
      item.employerName,
      item.notes
    ].filter(Boolean).join(" · ");
    li.append(link, meta);
    if (item.status === "unknown_after_click" && item.runId !== undefined) {
      li.append(renderUnknownAfterClickActions(item));
    }
    recentList.append(li);
  }
}

function renderUnknownAfterClickActions(item: ProcessedVacancy): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "recent-actions";
  const appliedButton = document.createElement("button");
  appliedButton.type = "button";
  appliedButton.className = "primary";
  appliedButton.textContent = "Applied";
  const skippedButton = document.createElement("button");
  skippedButton.type = "button";
  skippedButton.className = "danger";
  skippedButton.textContent = "Skip";

  appliedButton.addEventListener("click", () => {
    void resolveUnknownAfterClick(item, "applied", [appliedButton, skippedButton]);
  });
  skippedButton.addEventListener("click", () => {
    void resolveUnknownAfterClick(item, "skipped", [appliedButton, skippedButton]);
  });

  actions.append(appliedButton, skippedButton);
  return actions;
}

async function resolveUnknownAfterClick(
  item: ProcessedVacancy,
  status: Extract<VacancyResultStatus, "applied" | "skipped">,
  buttons: HTMLButtonElement[]
): Promise<void> {
  if (item.runId === undefined) {
    message.textContent = "Cannot resolve unknown result without runId.";
    return;
  }
  for (const button of buttons) {
    button.disabled = true;
  }
  try {
    const settings = readSettings();
    await saveBootstrapSettings(settings);
    await recordVacancyResult(settings, {
      runId: item.runId,
      vacancyId: item.vacancyId,
      status,
      ...(item.vacancyTitle === undefined
        ? {}
        : { vacancyTitle: item.vacancyTitle }),
      ...(item.employerName === undefined
        ? {}
        : { employerName: item.employerName }),
      ...(item.vacancyUrl === undefined ? {} : { vacancyUrl: item.vacancyUrl }),
      notes: `owner resolved unknown_after_click as ${status}`,
      manualOverride: true
    });
    message.textContent = `Resolved ${item.vacancyId} as ${status}.`;
    await refreshDashboard();
  } catch (error) {
    message.textContent =
      error instanceof Error ? error.message : "Failed to resolve vacancy.";
  } finally {
    for (const button of buttons) {
      button.disabled = false;
    }
  }
}

interface ActiveRunView {
  status: string;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
  settingsSnapshot?: {
    runLimit?: number;
  };
}

function parseActiveRun(response: Record<string, unknown>): ActiveRunView | null {
  const activeRun = response.activeRun;
  if (typeof activeRun !== "object" || activeRun === null) {
    return null;
  }
  const value = activeRun as Record<string, unknown>;
  if (typeof value.status !== "string") {
    return null;
  }
  const settingsSnapshot =
    typeof value.settingsSnapshot === "object" && value.settingsSnapshot !== null
      ? (value.settingsSnapshot as { runLimit?: unknown })
      : undefined;
  const parsed: ActiveRunView = {
    status: value.status,
    appliedCount:
      typeof value.appliedCount === "number" ? value.appliedCount : 0,
    skippedCount:
      typeof value.skippedCount === "number" ? value.skippedCount : 0,
    errorCount: typeof value.errorCount === "number" ? value.errorCount : 0
  };
  if (typeof settingsSnapshot?.runLimit === "number") {
    parsed.settingsSnapshot = { runLimit: settingsSnapshot.runLimit };
  }
  return parsed;
}

function formatRunStatusText(
  phase: string,
  statusMessage: string,
  activeRun: ActiveRunView | null
): string {
  if (activeRun === null) {
    return `${phase}: ${statusMessage}`;
  }
  const processed =
    activeRun.appliedCount + activeRun.skippedCount + activeRun.errorCount;
  const runLimit = activeRun.settingsSnapshot?.runLimit;
  const progress =
    runLimit === undefined ? `${processed}` : `${processed}/${runLimit}`;
  return `${activeRun.status}: ${statusMessage} (${progress})`;
}

function renderRunState(phase: string, activeStatus: string | null): void {
  if (phase === "running" || activeStatus === "running") {
    setRunState("running", "Running");
    return;
  }
  if (
    activeStatus === "paused_captcha" ||
    activeStatus === "paused_unknown" ||
    activeStatus === "paused_network"
  ) {
    setRunState("paused", "Paused");
    return;
  }
  if (phase === "stopping") {
    setRunState("stopped", "Stopping");
    return;
  }
  setRunState("idle", "Idle");
}

function setRunState(
  kind: "idle" | "running" | "paused" | "stopped",
  text: string
): void {
  runStateBadge.className = `run-state run-state-${kind}`;
  runStateBadge.textContent = text;
}

function readNumber(input: HTMLInputElement): number {
  return Number.parseInt(input.value, 10);
}

function renderPendingConfirmation(raw: unknown): void {
  const pending = parsePendingConfirmation(raw);
  if (pending === null) {
    confirmPanel.hidden = true;
    lastPendingVacancyId = null;
    return;
  }
  confirmPanel.hidden = false;
  confirmTitle.textContent = pending.title || pending.vacancyId;
  confirmEmployer.textContent = pending.employer;
  confirmLink.textContent = pending.url;
  confirmLink.href = pending.url;
  lastPendingVacancyId = pending.vacancyId;
}

function parsePendingConfirmation(raw: unknown): PendingConfirmationView | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as Partial<PendingConfirmationView>;
  if (
    typeof value.vacancyId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.employer !== "string" ||
    typeof value.url !== "string"
  ) {
    return null;
  }
  return {
    vacancyId: value.vacancyId,
    title: value.title,
    employer: value.employer,
    url: value.url
  };
}

async function runHealthCheck(): Promise<void> {
  setStatus("checking", "Checking");
  message.textContent = "Checking local backend...";
  healthButton.disabled = true;

  try {
    const settings = readSettings();
    await saveBootstrapSettings(settings);
    const result = await checkBackendHealth(settings);

    if (result.ok) {
      setStatus("ok", "Online");
    } else {
      setStatus("error", result.statusCode === 401 ? "Unauthorized" : "Offline");
    }
    message.textContent = result.message;
  } finally {
    healthButton.disabled = false;
  }
}

function readSettings(): BootstrapSettings {
  return {
    localBackendUrl: backendUrlInput.value,
    localSharedSecret: sharedSecretInput.value
  };
}

function setStatus(kind: "idle" | "checking" | "ok" | "error", text: string): void {
  statusBadge.className = `status status-${kind}`;
  statusBadge.textContent = text;
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing popup element: ${selector}`);
  }
  return element;
}

function sendRuntimeMessage(message: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: Record<string, unknown>) => {
      const error = chrome.runtime.lastError;
      if (error !== undefined) {
        reject(new Error(error.message));
        return;
      }
      resolve(response ?? {});
    });
  });
}

let statusPollingTimer: ReturnType<typeof setInterval> | null = null;

function startStatusPolling(): void {
  stopStatusPolling();
  statusPollingTimer = setInterval(() => {
    void refreshRunStatusAndCheckDone();
  }, 1500);
}

function stopStatusPolling(): void {
  if (statusPollingTimer !== null) {
    clearInterval(statusPollingTimer);
    statusPollingTimer = null;
  }
}

async function refreshRunStatusAndCheckDone(): Promise<void> {
  try {
    const response = await sendRuntimeMessage({
      type: POPUP_GET_STATUS
    });
    renderRunStatus(response);
    await refreshDashboard();
    const phase = typeof response.phase === "string" ? response.phase : "idle";
    if (phase === "idle") {
      stopStatusPolling();
      const statusMessage =
        typeof response.message === "string" ? response.message : "Idle";
      message.textContent = statusMessage;
    }
  } catch {
    stopStatusPolling();
  }
}
