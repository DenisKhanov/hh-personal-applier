import type { ConfirmDecision, PendingConfirmationView } from "./messages";

export interface PendingConfirmationRequest extends PendingConfirmationView {
  runId: string;
  tabId: number;
}

export interface StoredOwnerConfirmation extends PendingConfirmationRequest {
  createdAtMs: number;
  expiresAtMs: number;
}

export interface OwnerConfirmationDeps {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now?(): number;
  savePending?(record: StoredOwnerConfirmation): Promise<void>;
  clearPending?(): Promise<void>;
  log?(message: string, data: Record<string, unknown>): void;
}

export interface OwnerConfirmationController {
  request(
    view: PendingConfirmationRequest,
    signal: AbortSignal,
    timeoutMs: number
  ): Promise<ConfirmDecision>;
  decide(vacancyId: string, decision: ConfirmDecision): boolean;
  getPending(): PendingConfirmationView | null;
}

interface InternalPending extends PendingConfirmationView {
  resolve(decision: ConfirmDecision): void;
}

export function createOwnerConfirmationController(
  deps: OwnerConfirmationDeps
): OwnerConfirmationController {
  let pending: InternalPending | null = null;
  const now = deps.now ?? Date.now;

  function clearPending(): void {
    pending = null;
  }

  async function clearAllPending(): Promise<void> {
    clearPending();
    await deps.clearPending?.();
  }

  return {
    getPending(): PendingConfirmationView | null {
      if (pending === null) {
        return null;
      }
      return {
        vacancyId: pending.vacancyId,
        title: pending.title,
        employer: pending.employer,
        url: pending.url
      };
    },

    decide(vacancyId: string, decision: ConfirmDecision): boolean {
      const current = pending;
      if (current === null || current.vacancyId !== vacancyId) {
        return false;
      }
      current.resolve(decision);
      return true;
    },

    request(
      view: PendingConfirmationRequest,
      signal: AbortSignal,
      timeoutMs: number
    ): Promise<ConfirmDecision> {
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        if (pending !== null) {
          // Defensive: another pending confirmation is still active. Caller
          // bug — sequential processCandidate should not produce concurrent
          // requests. Refuse loudly rather than silently overwrite.
          reject(
            new Error(
              `owner confirmation already pending for vacancyId=${pending.vacancyId}`
            )
          );
          return;
        }

        let settled = false;
        let timeoutHandle: unknown = null;

        const cleanup = async (): Promise<boolean> => {
          if (settled) return false;
          settled = true;
          if (timeoutHandle !== null) {
            deps.clearTimeout(timeoutHandle);
          }
          signal.removeEventListener("abort", onAbort);
          await clearAllPending();
          return true;
        };

        const onAbort = (): void => {
          void cleanup().then(() => {
            reject(new DOMException("Aborted", "AbortError"));
          }, reject);
        };

        pending = {
          ...view,
          resolve: (decision: ConfirmDecision): void => {
            void cleanup().then(() => {
              resolve(decision);
            }, reject);
          }
        };

        const createdAtMs = now();
        const record: StoredOwnerConfirmation = {
          ...view,
          createdAtMs,
          expiresAtMs: createdAtMs + timeoutMs
        };

        timeoutHandle = deps.setTimeout(() => {
          void cleanup().then(() => {
            deps.log?.("owner confirmation timed out, treating as confirm", {
              vacancyId: view.vacancyId,
              timeoutMs
            });
            resolve("confirm");
          }, reject);
        }, timeoutMs);

        signal.addEventListener("abort", onAbort, { once: true });

        const savePending = deps.savePending?.(record) ?? Promise.resolve();
        void savePending.then(() => {
          if (settled) {
            return;
          }
          if (signal.aborted) {
            onAbort();
          }
        }, (error: unknown) => {
          void cleanup().then(() => {
            reject(error);
          }, reject);
        });
      });
    }
  };
}
