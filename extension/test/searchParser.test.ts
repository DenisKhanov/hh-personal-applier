import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHTML } from "linkedom";

import { parseSearchCandidates } from "../src/shared/searchParser.ts";

const fixtureUrl = new URL("./fixtures/search-results.html", import.meta.url);
const fixtureHtml = await readFile(fixtureUrl, "utf8");
const { document } = parseHTML(fixtureHtml);
const candidates = parseSearchCandidates(
  document,
  "https://hh.ru/search/vacancy?text=go"
);

function candidate(vacancyId: string) {
  const item = candidates.find((value) => value.vacancyId === vacancyId);
  assert.ok(item, `expected fixture candidate ${vacancyId}`);
  return item;
}

test("parses vacancy id, title, employer, and absolute url", () => {
  assert.equal(candidates.length, 6);
  assert.deepEqual(candidate("123456789"), {
    vacancyId: "123456789",
    title: "Go Backend Developer",
    employerName: "Acme Tech",
    vacancyUrl:
      "https://hh.ru/vacancy/123456789?query=go&hhtmFrom=vacancy_search_list",
    hasTest: false,
    isExternal: false,
    isArchived: false,
    requiresLetter: false
  });
});

test("detects test-required vacancies", () => {
  const item = candidate("223456789");
  assert.equal(item.vacancyUrl, "https://hh.ru/vacancy/223456789");
  assert.equal(item.hasTest, true);
});

test("detects external apply vacancies", () => {
  assert.equal(candidate("323456789").isExternal, true);
});

test("detects archived vacancies", () => {
  assert.equal(candidate("423456789").isArchived, true);
});

test("detects required cover letter vacancies when the card exposes the signal", () => {
  assert.equal(candidate("523456789").requiresLetter, true);
});

test("ignores cards without a title link", () => {
  assert.equal(
    candidates.some((value) => value.vacancyId === "623456789"),
    false
  );
});

test("keeps cards without employer text and returns an empty employer name", () => {
  assert.deepEqual(candidate("723456789"), {
    vacancyId: "723456789",
    title: "No Employer Vacancy",
    employerName: "",
    vacancyUrl: "https://hh.ru/vacancy/723456789?from=fixture",
    hasTest: false,
    isExternal: false,
    isArchived: false,
    requiresLetter: false
  });
});
