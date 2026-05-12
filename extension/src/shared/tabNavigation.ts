export interface TabReadinessSnapshot {
  readyState: "loading" | "interactive" | "complete" | "unknown";
  href: string;
}

export interface TabNavigationDeps {
  update(tabId: number, url: string): Promise<void>;
  // Returns null on transient failures (frame teardown, "cannot access contents
  // of url", "no frame with id"). Callers treat null as not-ready and keep polling.
  probeReadiness(tabId: number): Promise<TabReadinessSnapshot | null>;
  delay(ms: number): Promise<void>;
  log?(message: string, data: Record<string, unknown>): void;
}

export interface WaitForTabReadyOptions {
  expectedUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export class TabNavigationTimeoutError extends Error {
  readonly snapshot: TabReadinessSnapshot | null;

  constructor(url: string, snapshot: TabReadinessSnapshot | null) {
    super(
      url === ""
        ? "Timed out waiting for tab to become ready"
        : `Timed out waiting for vacancy page to load: ${url}`
    );
    this.name = "TabNavigationTimeoutError";
    this.snapshot = snapshot;
  }
}

export async function waitForTabReady(
  tabId: number,
  signal: AbortSignal,
  deps: TabNavigationDeps,
  opts: WaitForTabReadyOptions = {}
): Promise<TabReadinessSnapshot> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot: TabReadinessSnapshot | null = null;
  let firstIteration = true;

  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (!firstIteration) {
      await deps.delay(pollIntervalMs);
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
    }
    firstIteration = false;

    const snapshot = await deps.probeReadiness(tabId);
    if (snapshot === null) {
      continue;
    }

    lastSnapshot = snapshot;

    if (
      opts.expectedUrl !== undefined &&
      !pathnamesMatch(snapshot.href, opts.expectedUrl)
    ) {
      continue;
    }

    if (snapshot.readyState === "loading") {
      continue;
    }

    return snapshot;
  }

  deps.log?.("waitForTabReady timed out", {
    expectedUrl: opts.expectedUrl ?? null,
    timeoutMs,
    lastSnapshot
  });

  throw new TabNavigationTimeoutError(opts.expectedUrl ?? "", lastSnapshot);
}

export async function navigateAndWait(
  tabId: number,
  url: string,
  signal: AbortSignal,
  deps: TabNavigationDeps,
  opts: Pick<WaitForTabReadyOptions, "timeoutMs" | "pollIntervalMs"> = {}
): Promise<TabReadinessSnapshot> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  await deps.update(tabId, url);
  return waitForTabReady(tabId, signal, deps, { expectedUrl: url, ...opts });
}

function pathnamesMatch(rawHref: string, expectedUrl: string): boolean {
  try {
    const actual = new URL(rawHref);
    const expected = new URL(expectedUrl);
    return (
      actual.hostname === expected.hostname &&
      actual.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}
