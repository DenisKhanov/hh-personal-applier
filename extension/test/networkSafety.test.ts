import assert from "node:assert/strict";
import test from "node:test";

import { BackendApiError } from "../src/shared/api.ts";
import {
  isBackendNetworkError,
  networkSafetyEvent
} from "../src/shared/networkSafety.ts";

test("detects backend network errors", () => {
  assert.equal(
    isBackendNetworkError(
      new BackendApiError(0, "backend_network_error", "failed")
    ),
    true
  );
  assert.equal(
    isBackendNetworkError(new BackendApiError(500, "backend_error", "failed")),
    false
  );
});

test("builds network safety event details for backend pause", () => {
  const event = networkSafetyEvent("run-1", new Error("offline"));

  assert.equal(event.runId, "run-1");
  assert.equal(event.message, "Backend network request failed after retries.");
  assert.deepEqual(event.details, {
    code: "backend_network_error",
    safety: "network",
    cause: "offline"
  });
});
