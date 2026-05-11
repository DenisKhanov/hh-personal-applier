import type { CandidatesResult } from "./api";

export type RunStopReason =
  | "daily_limit_reached"
  | "run_limit_reached"
  | "no_more_vacancies";

export function completionReason(result: CandidatesResult): RunStopReason {
  if (result.remainingDaily <= 0) {
    return "daily_limit_reached";
  }
  if (result.remainingRun <= 0) {
    return "run_limit_reached";
  }
  return "no_more_vacancies";
}
