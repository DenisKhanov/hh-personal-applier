import {
  checkBackendHealth,
  loadBootstrapSettings,
  saveBootstrapSettings,
  type BootstrapSettings
} from "../shared/api";

const backendUrlInput = query<HTMLInputElement>("#backendUrl");
const sharedSecretInput = query<HTMLInputElement>("#sharedSecret");
const saveButton = query<HTMLButtonElement>("#saveButton");
const healthButton = query<HTMLButtonElement>("#healthButton");
const statusBadge = query<HTMLElement>("#statusBadge");
const message = query<HTMLElement>("#message");

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
}

async function saveCurrentSettings(): Promise<void> {
  await saveBootstrapSettings(readSettings());
  setStatus("idle", "Saved");
  message.textContent = "Bootstrap settings saved locally.";
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
