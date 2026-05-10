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

export interface OwnerSettings {
  dailyLimit: number;
  runLimit: number;
  paceMinSeconds: number;
  paceMaxSeconds: number;
  skipWithTest: boolean;
  skipExternal: boolean;
  requireCoverLetterApproval: boolean;
  autoApply: boolean;
}

export type RunStatus =
  | "running"
  | "paused_captcha"
  | "paused_unknown"
  | "paused_network"
  | "stopped"
  | "completed";

export interface ApplyRun {
  runId: string;
  status: RunStatus;
  searchUrl: string;
  settingsSnapshot: OwnerSettings;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
  stopReason?: string;
}

export interface CandidateItem {
  vacancyId: string;
  title: string;
  employerName: string;
  vacancyUrl: string;
  hasTest?: boolean;
  isExternal?: boolean;
  isArchived?: boolean;
  requiresLetter?: boolean;
}

export interface CandidateRejection {
  vacancyId: string;
  reason: string;
  status?: string;
}

export interface CandidatesResult {
  allow: string[];
  rejected: CandidateRejection[];
  remainingDaily: number;
  remainingRun: number;
}

export interface AttemptStart {
  runId: string;
  vacancyId: string;
  vacancyTitle: string;
  employerName: string;
  vacancyUrl: string;
  notes?: string;
}

export interface AttemptStartResult {
  started: boolean;
  reason?: string;
}

export type VacancyResultStatus =
  | "applied"
  | "skipped"
  | "skipped_test"
  | "skipped_external"
  | "skipped_archived"
  | "skipped_already_applied"
  | "skipped_cover_letter"
  | "manual_action"
  | "unknown_after_click"
  | "error";

export interface VacancyResult {
  runId: string;
  vacancyId: string;
  status: VacancyResultStatus;
  vacancyTitle?: string;
  employerName?: string;
  vacancyUrl?: string;
  notes?: string;
  manualOverride?: boolean;
}

export interface VacancyResultOutcome {
  status: VacancyResultStatus;
  counted: boolean;
  idempotent: boolean;
}

export interface TodayStats {
  applied: number;
  skipped: number;
  errors: number;
  remainingDaily: number;
  activeRun: ApplyRun | null;
}

export interface SafetyEvent {
  runId?: string;
  vacancyId?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface EventResult {
  recorded: boolean;
}

interface BackendErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

export class BackendApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "BackendApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
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

export async function getSettings(
  settings: BootstrapSettings
): Promise<OwnerSettings> {
  return requestJSON<OwnerSettings>(settings, "/settings", { method: "GET" });
}

export async function updateSettings(
  settings: BootstrapSettings,
  ownerSettings: OwnerSettings
): Promise<OwnerSettings> {
  return requestJSON<OwnerSettings>(settings, "/settings", {
    method: "PUT",
    body: ownerSettings
  });
}

export async function startRun(
  settings: BootstrapSettings,
  searchUrl: string
): Promise<ApplyRun> {
  return requestJSON<ApplyRun>(settings, "/runs/start", {
    method: "POST",
    body: { searchUrl }
  });
}

export async function stopRun(
  settings: BootstrapSettings,
  runId: string,
  reason: string
): Promise<ApplyRun> {
  return requestJSON<ApplyRun>(settings, "/runs/stop", {
    method: "POST",
    body: { runId, reason }
  });
}

export async function continueRun(
  settings: BootstrapSettings,
  runId: string
): Promise<ApplyRun> {
  return requestJSON<ApplyRun>(settings, "/runs/continue", {
    method: "POST",
    body: { runId }
  });
}

export async function filterCandidates(
  settings: BootstrapSettings,
  runId: string,
  items: CandidateItem[]
): Promise<CandidatesResult> {
  return requestJSON<CandidatesResult>(settings, "/candidates", {
    method: "POST",
    body: { runId, items }
  });
}

export async function startAttempt(
  settings: BootstrapSettings,
  attempt: AttemptStart
): Promise<AttemptStartResult> {
  return requestJSON<AttemptStartResult>(settings, "/attempts/start", {
    method: "POST",
    body: attempt
  });
}

export async function recordVacancyResult(
  settings: BootstrapSettings,
  result: VacancyResult
): Promise<VacancyResultOutcome> {
  return requestJSON<VacancyResultOutcome>(settings, "/vacancies/result", {
    method: "POST",
    body: result
  });
}

export async function getTodayStats(
  settings: BootstrapSettings
): Promise<TodayStats> {
  return requestJSON<TodayStats>(settings, "/stats/today", { method: "GET" });
}

export async function recordCaptchaEvent(
  settings: BootstrapSettings,
  event: SafetyEvent
): Promise<EventResult> {
  return recordEvent(settings, "/events/captcha", event);
}

export async function recordLoginLostEvent(
  settings: BootstrapSettings,
  event: SafetyEvent
): Promise<EventResult> {
  return recordEvent(settings, "/events/login_lost", event);
}

export async function recordErrorEvent(
  settings: BootstrapSettings,
  event: SafetyEvent
): Promise<EventResult> {
  return recordEvent(settings, "/events/error", event);
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

async function recordEvent(
  settings: BootstrapSettings,
  path: string,
  event: SafetyEvent
): Promise<EventResult> {
  return requestJSON<EventResult>(settings, path, {
    method: "POST",
    body: event
  });
}

async function requestJSON<T>(
  settings: BootstrapSettings,
  path: string,
  options: {
    method: "GET" | "POST" | "PUT";
    body?: unknown;
  }
): Promise<T> {
  const backendUrl = normalizeBackendUrl(settings.localBackendUrl);
  const secret = settings.localSharedSecret.trim();

  if (secret === "") {
    throw new BackendApiError(
      0,
      "missing_local_secret",
      "Set X-Local-Secret before calling backend."
    );
  }

  const requestInit: RequestInit = {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      "X-Local-Secret": secret
    }
  };
  if (options.body !== undefined) {
    requestInit.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${backendUrl}${path}`, requestInit);

  const text = await response.text();
  const body = parseBackendBody(text, response.status);

  if (!response.ok) {
    const backendError = isBackendErrorBody(body) ? body.error : undefined;
    throw new BackendApiError(
      response.status,
      backendError?.code ?? "backend_error",
      backendError?.message ?? `Backend returned HTTP ${response.status}.`,
      backendError?.details ?? {}
    );
  }

  return body as T;
}

function parseBackendBody(text: string, statusCode: number): unknown {
  if (text === "") {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BackendApiError(
      statusCode,
      "invalid_backend_response",
      "Backend returned a non-JSON response."
    );
  }
}

function isBackendErrorBody(value: unknown): value is BackendErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const error = (value as BackendErrorBody).error;
  return typeof error === "object" && error !== null;
}
