import assert from "node:assert/strict";
import test from "node:test";

import { createOwnerConfirmationController } from "../src/shared/ownerConfirmation.ts";
import type { PendingConfirmationView } from "../src/shared/messages.ts";

interface FakeTimerControls {
  fire(): void;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  lastDelayMs(): number | null;
}

function makeFakeTimer(): FakeTimerControls {
  let handler: (() => void) | null = null;
  let lastMs: number | null = null;

  return {
    fire(): void {
      handler?.();
    },
    setTimeout(h, ms): unknown {
      handler = h;
      lastMs = ms;
      return Symbol("timer");
    },
    clearTimeout(): void {
      handler = null;
    },
    lastDelayMs(): number | null {
      return lastMs;
    }
  };
}

const candidate: PendingConfirmationView = {
  vacancyId: "132288118",
  title: "Go Backend Developer",
  employer: "Acme",
  url: "https://hh.ru/vacancy/132288118"
};

test("request resolves to 'confirm' when decide is called with confirm", async () => {
  const timer = makeFakeTimer();
  const controller = createOwnerConfirmationController({
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });

  const pending = controller.request(candidate, new AbortController().signal, 1000);
  assert.deepEqual(controller.getPending(), candidate);

  assert.equal(controller.decide("132288118", "confirm"), true);
  const decision = await pending;

  assert.equal(decision, "confirm");
  assert.equal(controller.getPending(), null);
});

test("request persists pending confirmation and clears it after confirm", async () => {
  const timer = makeFakeTimer();
  const persisted: unknown[] = [];
  let clearCalls = 0;
  const controller = createOwnerConfirmationController({
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    now: () => 1_000,
    savePending: async (record: unknown): Promise<void> => {
      persisted.push(record);
    },
    clearPending: async (): Promise<void> => {
      clearCalls += 1;
    }
  });

  const pending = controller.request(
    { ...candidate, runId: "run-1", tabId: 7 },
    new AbortController().signal,
    5_000
  );
  await Promise.resolve();

  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0], {
    ...candidate,
    runId: "run-1",
    tabId: 7,
    createdAtMs: 1_000,
    expiresAtMs: 6_000
  });

  assert.equal(controller.decide("132288118", "confirm"), true);
  assert.equal(await pending, "confirm");
  assert.equal(clearCalls, 1);
});

test("request resolves to 'skip' when decide is called with skip", async () => {
  const timer = makeFakeTimer();
  const controller = createOwnerConfirmationController({
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });

  const pending = controller.request(candidate, new AbortController().signal, 1000);
  controller.decide("132288118", "skip");
  const decision = await pending;

  assert.equal(decision, "skip");
});

test("request auto-confirms on timeout after 30 seconds and logs", async () => {
  const timer = makeFakeTimer();
  const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
  const controller = createOwnerConfirmationController({
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    log(message, data): void {
      logs.push({ message, data });
    }
  });

  const pending = controller.request(candidate, new AbortController().signal, 30_000);
  assert.equal(timer.lastDelayMs(), 30_000);

  timer.fire();
  const decision = await pending;

  assert.equal(decision, "confirm");
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.data["vacancyId"], "132288118");
  assert.equal(controller.getPending(), null);
});

test("request clears persisted confirmation on timeout", async () => {
  const timer = makeFakeTimer();
  let clearCalls = 0;
  const controller = createOwnerConfirmationController({
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    savePending: async (): Promise<void> => {},
    clearPending: async (): Promise<void> => {
      clearCalls += 1;
    }
  });

  const pending = controller.request(
    { ...candidate, runId: "run-1", tabId: 7 },
    new AbortController().signal,
    1_000
  );
  timer.fire();

  assert.equal(await pending, "confirm");
  assert.equal(clearCalls, 1);
});

test("request rejects with AbortError when signal aborts during wait", async () => {
  const timer = makeFakeTimer();
  const controller = createOwnerConfirmationController({
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });

  const ac = new AbortController();
  const pending = controller.request(candidate, ac.signal, 1000);

  ac.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof DOMException);
    assert.equal(error.name, "AbortError");
    return true;
  });
  assert.equal(controller.getPending(), null);
});

test("request clears persisted confirmation on abort", async () => {
  const timer = makeFakeTimer();
  let clearCalls = 0;
  const controller = createOwnerConfirmationController({
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    savePending: async (): Promise<void> => {},
    clearPending: async (): Promise<void> => {
      clearCalls += 1;
    }
  });

  const ac = new AbortController();
  const pending = controller.request(
    { ...candidate, runId: "run-1", tabId: 7 },
    ac.signal,
    1_000
  );

  ac.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof DOMException);
    assert.equal(error.name, "AbortError");
    return true;
  });
  assert.equal(clearCalls, 1);
});

test("decide for unknown vacancyId is a no-op", async () => {
  const timer = makeFakeTimer();
  const controller = createOwnerConfirmationController({
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });

  void controller.request(candidate, new AbortController().signal, 1000);
  assert.equal(controller.decide("999", "confirm"), false);
  // Still pending.
  assert.notEqual(controller.getPending(), null);
});

test("concurrent request rejects when another is already pending", async () => {
  const timer = makeFakeTimer();
  const controller = createOwnerConfirmationController({
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });

  void controller.request(candidate, new AbortController().signal, 1000);
  const second = controller.request(
    { ...candidate, vacancyId: "999" },
    new AbortController().signal,
    1000
  );

  await assert.rejects(second, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /already pending/);
    return true;
  });
});
