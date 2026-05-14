import assert from "node:assert/strict";
import test from "node:test";

import { nextSearchPageUrl } from "../src/shared/searchPagination.ts";

test("adds page=1 to first hh search page", () => {
  assert.equal(
    nextSearchPageUrl("https://hh.ru/search/vacancy?text=go&area=1"),
    "https://hh.ru/search/vacancy?text=go&area=1&page=1"
  );
});

test("increments existing search page", () => {
  assert.equal(
    nextSearchPageUrl("https://hh.ru/search/vacancy?text=go&page=2"),
    "https://hh.ru/search/vacancy?text=go&page=3"
  );
});
