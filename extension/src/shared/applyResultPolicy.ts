import type { SafetyEvent, VacancyResultStatus } from "./api";

interface ContinuableResultInput {
  runId: string;
  vacancyId: string;
  status: VacancyResultStatus;
  vacancyUrl: string;
  notes?: string | undefined;
}

export function shouldNotifyContinuableResult(
  status: VacancyResultStatus
): boolean {
  return status === "unknown_after_click" || status === "manual_action";
}

export function notificationForContinuableResult(
  input: ContinuableResultInput
): SafetyEvent {
  const message =
    input.status === "manual_action"
      ? "Manual action required after click"
      : "Unknown state after click";

  return {
    runId: input.runId,
    vacancyId: input.vacancyId,
    vacancyUrl: input.vacancyUrl,
    message,
    nonBlocking: true,
    details: {
      status: input.status,
      notes: input.notes ?? ""
    }
  };
}
