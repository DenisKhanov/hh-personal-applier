import assert from "node:assert/strict";
import test from "node:test";

import {
  BackendApiError,
  getSettings,
  type BootstrapSettings
} from "../src/shared/api.ts";

const settings: BootstrapSettings = {
  localBackendUrl: "http://127.0.0.1:8080",
  localSharedSecret: "12345678901234567890123456789012"
};

test("backend JSON requests retry transient network failures before succeeding", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls < 3) {
      throw new TypeError("Failed to fetch");
    }
    return new Response(
      JSON.stringify({
        dailyLimit: 100,
        runLimit: 25,
        paceMinSeconds: 6,
        paceMaxSeconds: 14,
        skipWithTest: true,
        skipExternal: true,
        requireCoverLetterApproval: true,
        autoApply: false
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await getSettings(settings);
    assert.equal(result.dailyLimit, 100);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("backend JSON requests fail as paused network after retry budget is exhausted", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;

  try {
    await assert.rejects(
      getSettings(settings),
      (error: unknown) =>
        error instanceof BackendApiError &&
        error.statusCode === 0 &&
        error.code === "backend_network_error" &&
        calls === 4
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
