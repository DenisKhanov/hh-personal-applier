import assert from "node:assert/strict";
import test from "node:test";

import {
  waitForTabNavigationComplete,
  type TabNavigationDeps,
  type TabUpdatedListener
} from "../src/shared/tabNavigation.ts";

function fakeDeps(
  overrides: Partial<TabNavigationDeps> = {}
): TabNavigationDeps & {
  listener: TabUpdatedListener | null;
  removed: boolean;
  timeoutHandler: (() => void) | null;
} {
  const deps = {
    listener: null as TabUpdatedListener | null,
    removed: false,
    timeoutHandler: null as (() => void) | null,
    async update(): Promise<void> {},
    async get(): Promise<{ status: string }> {
      return { status: "loading" };
    },
    addUpdatedListener(listener: TabUpdatedListener): void {
      deps.listener = listener;
    },
    removeUpdatedListener(listener: TabUpdatedListener): void {
      if (deps.listener === listener) {
        deps.removed = true;
        deps.listener = null;
      }
    },
    setTimeout(handler: () => void): unknown {
      deps.timeoutHandler = handler;
      return "timeout";
    },
    clearTimeout(): void {},
    ...overrides
  };

  return deps;
}

test("resolves when tab update reports complete", async () => {
  const deps = fakeDeps({
    async update(): Promise<void> {
      deps.listener?.(7, { status: "complete" }, { status: "complete" });
    }
  });

  await waitForTabNavigationComplete(
    7,
    "https://hh.ru/vacancy/132728151",
    new AbortController().signal,
    deps
  );

  assert.equal(deps.removed, true);
});

test("checks current tab after update so a missed complete event does not hang", async () => {
  const deps = fakeDeps({
    async get(): Promise<{ status: string }> {
      return { status: "complete" };
    }
  });

  await waitForTabNavigationComplete(
    7,
    "https://hh.ru/vacancy/132728151",
    new AbortController().signal,
    deps
  );

  assert.equal(deps.removed, true);
});
