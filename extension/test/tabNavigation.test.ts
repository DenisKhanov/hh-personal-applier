import assert from "node:assert/strict";
import test from "node:test";

import {
  TabNavigationTimeoutError,
  navigateAndWait,
  waitForTabReady,
  type TabNavigationDeps,
  type TabReadinessSnapshot
} from "../src/shared/tabNavigation.ts";

interface RecordingDeps extends TabNavigationDeps {
  readonly updates: Array<{ tabId: number; url: string }>;
  readonly probeCount: () => number;
  readonly logs: Array<{ message: string; data: Record<string, unknown> }>;
}

function makeDeps(
  probes: Array<TabReadinessSnapshot | null | "throw">
): RecordingDeps {
  const updates: Array<{ tabId: number; url: string }> = [];
  const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
  let index = 0;
  let probeCalls = 0;

  return {
    updates,
    logs,
    probeCount: () => probeCalls,
    async update(tabId: number, url: string): Promise<void> {
      updates.push({ tabId, url });
    },
    async probeReadiness(): Promise<TabReadinessSnapshot | null> {
      probeCalls += 1;
      const next =
        index < probes.length ? probes[index] : probes[probes.length - 1];
      if (index < probes.length - 1) {
        index += 1;
      }
      if (next === "throw" || next === null || next === undefined) {
        return null;
      }
      return next;
    },
    async delay(): Promise<void> {},
    log(message: string, data: Record<string, unknown>): void {
      logs.push({ message, data });
    }
  };
}

test("waitForTabReady resolves when DOM is interactive and URL matches", async () => {
  const deps = makeDeps([
    { readyState: "interactive", href: "https://hh.ru/vacancy/132288118" }
  ]);

  const snapshot = await waitForTabReady(7, new AbortController().signal, deps, {
    expectedUrl: "https://hh.ru/vacancy/132288118?query=go"
  });

  assert.equal(snapshot.readyState, "interactive");
});

test("waitForTabReady ignores stale page during URL transition", async () => {
  // First probe: still on previous search page (URL mismatch despite "complete").
  // Then loading on target URL. Then interactive on target URL.
  const deps = makeDeps([
    { readyState: "complete", href: "https://hh.ru/search/vacancy?text=go" },
    { readyState: "loading", href: "https://hh.ru/vacancy/132288118" },
    { readyState: "interactive", href: "https://hh.ru/vacancy/132288118" }
  ]);

  const snapshot = await waitForTabReady(7, new AbortController().signal, deps, {
    expectedUrl: "https://hh.ru/vacancy/132288118?query=go"
  });

  assert.equal(snapshot.href, "https://hh.ru/vacancy/132288118");
  assert.equal(deps.probeCount(), 3);
});

test("waitForTabReady treats transient null snapshots as not-ready", async () => {
  const deps = makeDeps([
    null,
    null,
    { readyState: "interactive", href: "https://hh.ru/vacancy/132288118" }
  ]);

  await waitForTabReady(7, new AbortController().signal, deps, {
    expectedUrl: "https://hh.ru/vacancy/132288118"
  });

  assert.equal(deps.probeCount(), 3);
});

test("waitForTabReady without expectedUrl waits for non-loading state", async () => {
  const deps = makeDeps([
    { readyState: "loading", href: "https://hh.ru/applicant/vacancy_response?vacancyId=1" },
    { readyState: "complete", href: "https://hh.ru/applicant/vacancy_response?vacancyId=1" }
  ]);

  const snapshot = await waitForTabReady(7, new AbortController().signal, deps);

  assert.equal(snapshot.readyState, "complete");
});

test("waitForTabReady throws with last snapshot when timeout exceeded", async () => {
  const deps = makeDeps([
    { readyState: "loading", href: "https://hh.ru/vacancy/132288118" }
  ]);

  await assert.rejects(
    () =>
      waitForTabReady(7, new AbortController().signal, deps, {
        expectedUrl: "https://hh.ru/vacancy/132288118",
        timeoutMs: 50
      }),
    (error: unknown) => {
      assert.ok(error instanceof TabNavigationTimeoutError);
      assert.equal(error.snapshot?.readyState, "loading");
      return true;
    }
  );

  // Diagnostic log must include final snapshot.
  assert.equal(deps.logs.length, 1);
  assert.equal(
    (deps.logs[0]?.data["lastSnapshot"] as TabReadinessSnapshot | null)?.readyState,
    "loading"
  );
});

test("waitForTabReady respects abort signal", async () => {
  const controller = new AbortController();
  const deps = makeDeps([
    { readyState: "loading", href: "https://hh.ru/vacancy/132288118" }
  ]);
  // Wrap delay to fire abort on first delay tick.
  const wrappedDeps: TabNavigationDeps = {
    ...deps,
    async delay(): Promise<void> {
      controller.abort();
    }
  };

  await assert.rejects(
    () =>
      waitForTabReady(7, controller.signal, wrappedDeps, {
        expectedUrl: "https://hh.ru/vacancy/132288118"
      }),
    (error: unknown) => {
      assert.ok(error instanceof DOMException);
      assert.equal(error.name, "AbortError");
      return true;
    }
  );
});

test("navigateAndWait calls update then waits for ready", async () => {
  const deps = makeDeps([
    { readyState: "interactive", href: "https://hh.ru/vacancy/132288118" }
  ]);

  await navigateAndWait(
    7,
    "https://hh.ru/vacancy/132288118?query=go",
    new AbortController().signal,
    deps
  );

  assert.deepEqual(deps.updates, [
    { tabId: 7, url: "https://hh.ru/vacancy/132288118?query=go" }
  ]);
});
