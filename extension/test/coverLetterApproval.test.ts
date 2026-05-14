import assert from "node:assert/strict";
import test from "node:test";

import {
  COVER_LETTER_APPROVAL_TIMEOUT_MS,
  pollCoverLetterApproval
} from "../src/shared/coverLetterApproval.ts";
import type { CoverLetter } from "../src/shared/api.ts";

function pendingLetter(): CoverLetter {
  return {
    id: "letter-42",
    vacancyId: "42",
    language: "ru",
    status: "pending_approval",
    expiresAt: "2026-05-14T12:15:00Z"
  };
}

test("cover letter polling returns approved letter without waiting for timeout", async () => {
  const calls: string[] = [];
  const result = await pollCoverLetterApproval("42", new AbortController().signal, {
    pollMs: 5_000,
    timeoutMs: COVER_LETTER_APPROVAL_TIMEOUT_MS,
    now: () => 1_000,
    getCoverLetter: async (vacancyId) => {
      calls.push(vacancyId);
      return {
        ...pendingLetter(),
        status: "approved",
        body: "Здравствуйте! Готов выполнить задачи."
      };
    },
    delay: async () => {}
  });

  assert.equal(result.status, "approved");
  assert.equal(result.body, "Здравствуйте! Готов выполнить задачи.");
  assert.deepEqual(calls, ["42"]);
});

test("cover letter polling expires after 15 minutes without owner reaction", async () => {
  let now = 10_000;
  const result = await pollCoverLetterApproval("42", new AbortController().signal, {
    pollMs: 5_000,
    timeoutMs: COVER_LETTER_APPROVAL_TIMEOUT_MS,
    now: () => now,
    getCoverLetter: async () => pendingLetter(),
    delay: async (ms) => {
      now += ms;
    }
  });

  assert.equal(result.status, "expired");
  assert.equal(now, 10_000 + COVER_LETTER_APPROVAL_TIMEOUT_MS);
});
