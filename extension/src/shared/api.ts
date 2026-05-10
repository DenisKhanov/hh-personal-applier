export const DEFAULT_BACKEND_URL = "http://127.0.0.1:8080";
export const LOCAL_BACKEND_URL_KEY = "localBackendUrl";
export const LOCAL_SHARED_SECRET_KEY = "localSharedSecret";

export interface BootstrapSettings {
  localBackendUrl: string;
  localSharedSecret: string;
}

export interface HealthResult {
  ok: boolean;
  statusCode: number | null;
  message: string;
}

export async function loadBootstrapSettings(): Promise<BootstrapSettings> {
  const stored = await chrome.storage.local.get([
    LOCAL_BACKEND_URL_KEY,
    LOCAL_SHARED_SECRET_KEY
  ]);

  return {
    localBackendUrl:
      typeof stored[LOCAL_BACKEND_URL_KEY] === "string" &&
      stored[LOCAL_BACKEND_URL_KEY].trim() !== ""
        ? stored[LOCAL_BACKEND_URL_KEY]
        : DEFAULT_BACKEND_URL,
    localSharedSecret:
      typeof stored[LOCAL_SHARED_SECRET_KEY] === "string"
        ? stored[LOCAL_SHARED_SECRET_KEY]
        : ""
  };
}

export async function saveBootstrapSettings(
  settings: BootstrapSettings
): Promise<void> {
  await chrome.storage.local.set({
    [LOCAL_BACKEND_URL_KEY]: normalizeBackendUrl(settings.localBackendUrl),
    [LOCAL_SHARED_SECRET_KEY]: settings.localSharedSecret.trim()
  });
}

export async function checkBackendHealth(
  settings: BootstrapSettings
): Promise<HealthResult> {
  const backendUrl = normalizeBackendUrl(settings.localBackendUrl);
  const secret = settings.localSharedSecret.trim();

  if (secret === "") {
    return {
      ok: false,
      statusCode: null,
      message: "Set X-Local-Secret before checking backend health."
    };
  }

  try {
    const response = await fetch(`${backendUrl}/health`, {
      method: "GET",
      headers: {
        "X-Local-Secret": secret
      }
    });

    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        message: `Backend returned HTTP ${response.status}.`
      };
    }

    const body: unknown = await response.json();
    if (isHealthBody(body)) {
      return {
        ok: body.status === "ok",
        statusCode: response.status,
        message:
          body.status === "ok"
            ? "Backend is reachable."
            : `Unexpected health status: ${body.status}.`
      };
    }

    return {
      ok: false,
      statusCode: response.status,
      message: "Backend health response has an unexpected shape."
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      message:
        error instanceof Error
          ? error.message
          : "Backend health request failed."
    };
  }
}

export function normalizeBackendUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed === "" ? DEFAULT_BACKEND_URL : trimmed;
}

function isHealthBody(value: unknown): value is { status: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "string"
  );
}
