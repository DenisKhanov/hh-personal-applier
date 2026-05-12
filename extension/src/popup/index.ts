import {
  checkBackendHealth,
  loadBootstrapSettings,
  saveBootstrapSettings,
  sendTelegramTest,
  type BootstrapSettings
} from "../shared/api";
import {
  POPUP_CONFIRM_RESPONSE,
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
const stopButton = query<HTMLButtonElement>("#stopButton");
const statusBadge = query<HTMLElement>("#statusBadge");
const message = query<HTMLElement>("#message");
const runStatus = query<HTMLElement>("#runStatus");
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

  confirmButton.addEventListener("click", () => {
    void sendConfirmDecision("confirm");
  });

  skipButton.addEventListener("click", () => {
    void sendConfirmDecision("skip");
  });

  await refreshRunStatus();
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
  runStatus.textContent = `${phase}: ${statusMessage}`;
  renderPendingConfirmation(response.pendingConfirmation);
  if (phase === "running" || phase === "stopping") {
    startStatusPolling();
  }
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
