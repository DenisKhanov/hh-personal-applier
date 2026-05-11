import assert from "node:assert/strict";
import test from "node:test";

import { completionReason } from "../src/shared/runPolicy.ts";

test("completion reason is daily limit only when daily remaining is exhausted", () => {
  assert.equal(
    completionReason({
      allow: [],
      rejected: [],
      remainingDaily: 0,
      remainingRun: 12
    }),
    "daily_limit_reached"
  );
});

test("completion reason is run limit only when run remaining is exhausted", () => {
  assert.equal(
    completionReason({
      allow: [],
      rejected: [],
      remainingDaily: 30,
      remainingRun: 0
    }),
    "run_limit_reached"
  );
});

test("allowed candidates equal to current run capacity does not by itself mean run limit", () => {
  assert.equal(
    completionReason({
      allow: ["1", "2"],
      rejected: [],
      remainingDaily: 30,
      remainingRun: 2
    }),
    "no_more_vacancies"
  );
});
