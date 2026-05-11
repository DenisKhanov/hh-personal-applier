import assert from "node:assert/strict";
import test from "node:test";

import {
  isHhSearchVacancyUrl,
  isHhVacancyUrl
} from "../src/shared/pageGuards.ts";

test("accepts hh search vacancy URLs with query params and trailing slash", () => {
  assert.equal(
    isHhSearchVacancyUrl("https://hh.ru/search/vacancy?text=go&area=1"),
    true
  );
  assert.equal(
    isHhSearchVacancyUrl("https://hh.ru/search/vacancy/?text=go&area=1"),
    true
  );
});

test("rejects non-search and non-hh URLs", () => {
  assert.equal(isHhSearchVacancyUrl("https://hh.ru/vacancy/123"), false);
  assert.equal(isHhSearchVacancyUrl("https://example.test/search/vacancy"), false);
});

test("accepts only hh vacancy detail URLs", () => {
  assert.equal(isHhVacancyUrl("https://hh.ru/vacancy/123456789"), true);
  assert.equal(isHhVacancyUrl("https://hh.ru/vacancy/123456789?from=fixture"), true);
  assert.equal(isHhVacancyUrl("https://hh.ru/search/vacancy?text=go"), false);
  assert.equal(isHhVacancyUrl("https://example.test/vacancy/123456789"), false);
});
