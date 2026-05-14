import { BackendApiError, type SafetyEvent } from "./api.ts";

export function isBackendNetworkError(error: unknown): boolean {
  return (
    error instanceof BackendApiError &&
    error.code === "backend_network_error"
  );
}

export function networkSafetyEvent(
  runId: string,
  error: unknown
): SafetyEvent {
  const cause = error instanceof Error ? error.message : "unknown";
  return {
    runId,
    message: "Backend network request failed after retries.",
    details: {
      code: "backend_network_error",
      safety: "network",
      cause
    }
  };
}
