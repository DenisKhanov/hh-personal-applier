import assert from "node:assert/strict";
import test from "node:test";

import {
  notificationForContinuableResult,
  shouldNotifyContinuableResult
} from "../src/shared/applyResultPolicy.ts";

test("unknown_after_click is reported as a non-blocking notification", () => {
  assert.equal(shouldNotifyContinuableResult("unknown_after_click"), true);

  assert.deepEqual(
    notificationForContinuableResult({
      runId: "run-1",
      vacancyId: "132288118",
      status: "unknown_after_click",
      vacancyUrl: "https://hh.ru/vacancy/132288118",
      notes: "no known success state"
    }),
    {
      runId: "run-1",
      vacancyId: "132288118",
      vacancyUrl: "https://hh.ru/vacancy/132288118",
      message: "Unknown state after click",
      nonBlocking: true,
      details: {
        status: "unknown_after_click",
        notes: "no known success state"
      }
    }
  );
});

test("manual_action is reported without pausing the run", () => {
  assert.equal(shouldNotifyContinuableResult("manual_action"), true);

  assert.deepEqual(
    notificationForContinuableResult({
      runId: "run-1",
      vacancyId: "132288119",
      status: "manual_action",
      vacancyUrl: "https://hh.ru/vacancy/132288119",
      notes: "vacancy response page requires manual answers"
    }),
    {
      runId: "run-1",
      vacancyId: "132288119",
      vacancyUrl: "https://hh.ru/vacancy/132288119",
      message: "Manual action required after click",
      nonBlocking: true,
      details: {
        status: "manual_action",
        notes: "vacancy response page requires manual answers"
      }
    }
  );
});

test("applied results do not create per-vacancy Telegram notifications", () => {
  assert.equal(shouldNotifyContinuableResult("applied"), false);
});
