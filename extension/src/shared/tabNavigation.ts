export interface TabSnapshot {
  status?: string | undefined;
  url?: string | undefined;
}

export type TabUpdatedListener = (
  tabId: number,
  changeInfo: { status?: string | undefined },
  tab?: TabSnapshot
) => void;

export interface TabNavigationDeps {
  update(tabId: number, url: string): Promise<void>;
  get(tabId: number): Promise<TabSnapshot>;
  addUpdatedListener(listener: TabUpdatedListener): void;
  removeUpdatedListener(listener: TabUpdatedListener): void;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(timeoutId: unknown): void;
}

export class TabNavigationTimeoutError extends Error {
  constructor(url: string) {
    super(`Timed out waiting for vacancy page to load: ${url}`);
    this.name = "TabNavigationTimeoutError";
  }
}

export function waitForTabNavigationComplete(
  tabId: number,
  url: string,
  signal: AbortSignal,
  deps: TabNavigationDeps,
  timeoutMs = 30000
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = deps.setTimeout(() => {
      settle(() => reject(new TabNavigationTimeoutError(url)));
    }, timeoutMs);

    const cleanup = (): void => {
      deps.clearTimeout(timeoutId);
      deps.removeUpdatedListener(listener);
      signal.removeEventListener("abort", onAbort);
    };

    const settle = (complete: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      complete();
    };

    const resolveIfComplete = (snapshot: TabSnapshot): void => {
      if (snapshot.status === "complete") {
        settle(resolve);
      }
    };

    const onAbort = (): void => {
      settle(() => reject(new DOMException("Aborted", "AbortError")));
    };

    const listener: TabUpdatedListener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }
      resolveIfComplete(tab ?? { status: changeInfo.status });
    };

    signal.addEventListener("abort", onAbort, { once: true });
    deps.addUpdatedListener(listener);

    void deps
      .update(tabId, url)
      .then(() => deps.get(tabId))
      .then(resolveIfComplete)
      .catch((error: unknown) => {
        settle(() => reject(error));
      });
  });
}
