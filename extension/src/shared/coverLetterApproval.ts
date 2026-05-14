import type { CoverLetter } from "./api.ts";

export const COVER_LETTER_APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;

export interface CoverLetterApprovalPollDeps {
  getCoverLetter(vacancyId: string): Promise<CoverLetter>;
  delay(ms: number, signal: AbortSignal): Promise<void>;
  now?(): number;
  pollMs: number;
  timeoutMs: number;
}

export async function pollCoverLetterApproval(
  vacancyId: string,
  signal: AbortSignal,
  deps: CoverLetterApprovalPollDeps
): Promise<CoverLetter> {
  const now = deps.now ?? Date.now;
  const deadline = now() + deps.timeoutMs;

  for (;;) {
    ensureNotAborted(signal);
    const letter = await deps.getCoverLetter(vacancyId);
    if (letter.status !== "pending_approval") {
      return letter;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      return expiredLetter(letter);
    }

    await deps.delay(Math.min(deps.pollMs, remainingMs), signal);
  }
}

function expiredLetter(letter: CoverLetter): CoverLetter {
  return {
    ...letter,
    status: "expired"
  };
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}
