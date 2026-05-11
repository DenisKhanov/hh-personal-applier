import {
  checkBackendHealth,
  loadBootstrapSettings,
  saveBootstrapSettings,
  type BootstrapSettings
} from "../shared/api";
import {
  POPUP_GET_STATUS,
  POPUP_START_RUN,
  POPUP_STOP_RUN
} from "../shared/messages";

const backendUrlInput = query<HTMLInputElement>("#backendUrl");
const sharedSecretInput = query<HTMLInputElement>("#sharedSecret");
const saveButton = query<HTMLButtonElement>("#saveButton");
const healthButton = query<HTMLButtonElement>("#healthButton");
const startButton = query<HTMLButtonElement>("#startButton");
const stopButton = query<HTMLButtonElement>("#stopButton");
const statusBadge = query<HTMLElement>("#statusBadge");
const message = query<HTMLElement>("#message");
const runStatus = query<HTMLElement>("#runStatus");

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

  startButton.addEventListener("click", () => {
    void startRunFromPopup();
  });

  stopButton.addEventListener("click", () => {
    void stopRunFromPopup();
  });

  await refreshRunStatus();
}

async function saveCurrentSettings(): Promise<void> {
  await saveBootstrapSettings(readSettings());
  setStatus("idle", "Saved");
  message.textContent = "Bootstrap settings saved locally.";
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
