import type { CandidatesResult } from "./api";

export type RunStopReason =
  | "daily_limit_reached"
  | "run_limit_reached"
  | "no_more_vacancies";

export function completionReason(
  result: CandidatesResult,
  processedAllowedCount = 0
): RunStopReason {
  const remainingDaily = result.remainingDaily - processedAllowedCount;
  const remainingRun = result.remainingRun - processedAllowedCount;
  if (remainingDaily <= 0) {
    return "daily_limit_reached";
  }
  if (remainingRun <= 0) {
    return "run_limit_reached";
  }
  return "no_more_vacancies";
}
