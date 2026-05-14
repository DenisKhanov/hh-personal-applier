import assert from "node:assert/strict";
import test from "node:test";

import {
  POPUP_CONTINUE_RUN,
  isPopupContinueRunMessage
} from "../src/shared/messages.ts";

test("recognizes popup continue run message", () => {
  assert.equal(isPopupContinueRunMessage({ type: POPUP_CONTINUE_RUN }), true);
  assert.equal(isPopupContinueRunMessage({ type: "other" }), false);
});
