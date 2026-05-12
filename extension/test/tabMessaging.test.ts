import assert from "node:assert/strict";
import test from "node:test";

import {
  sendMessageWithInjection,
  type TabMessagingDeps
} from "../src/shared/tabMessaging.ts";

function makeAbortGuard(state: { aborted: boolean }): () => void {
  return () => {
    if (state.aborted) {
      throw new Error("aborted");
    }
  };
}

test("sendMessageWithInjection aborts after channel wait before script injection", async () => {
  const state = { aborted: false };
  let executeCalls = 0;
  const deps: TabMessagingDeps = {
    async sendTabMessage(): Promise<unknown> {
      throw new Error("message channel closed");
    },
    async waitForTabReady(): Promise<void> {
      state.aborted = true;
    },
    async executeScriptFile(): Promise<void> {
      executeCalls += 1;
    },
    ensureNotAborted: makeAbortGuard(state)
  };

  await assert.rejects(
    () =>
      sendMessageWithInjection(
        7,
        { type: "TEST" },
        "content/vacancy.js",
        new AbortController().signal,
        deps
      ),
    /aborted/
  );
  assert.equal(executeCalls, 0);
});

test("sendMessageWithInjection aborts after injection before retry send", async () => {
  const state = { aborted: false };
  let sendCalls = 0;
  const deps: TabMessagingDeps = {
    async sendTabMessage(): Promise<unknown> {
      sendCalls += 1;
      throw new Error("receiving end does not exist");
    },
    async waitForTabReady(): Promise<void> {},
    async executeScriptFile(): Promise<void> {
      state.aborted = true;
    },
    ensureNotAborted: makeAbortGuard(state)
  };

  await assert.rejects(
    () =>
      sendMessageWithInjection(
        7,
        { type: "TEST" },
        "content/vacancy.js",
        new AbortController().signal,
        deps
      ),
    /aborted/
  );
  assert.equal(sendCalls, 1);
});
