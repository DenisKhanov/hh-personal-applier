import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHTML } from "linkedom";

import {
  analyzeVacancyPage,
  findResponseSubmitButton,
  hasApplyButton
} from "../src/shared/vacancyPage.ts";

async function loadFixture(name: string): Promise<Document> {
  const fixtureUrl = new URL(`./fixtures/${name}`, import.meta.url);
  const fixtureHtml = await readFile(fixtureUrl, "utf8");
  return parseHTML(fixtureHtml).document;
}

test("detects a simple vacancy page ready for apply", async () => {
  const document = await loadFixture("vacancy-simple.html");

  assert.equal(hasApplyButton(document), true);
  assert.deepEqual(analyzeVacancyPage(document), {
    state: "ready",
    title: "Go Backend Developer",
    employerName: "Acme Tech"
  });
});

test("ignores archived/success words inside scripts when analyzing visible page", async () => {
  const document = await loadFixture("vacancy-simple.html");

  assert.equal(analyzeVacancyPage(document).state, "ready");
});

test("detects captcha before any click", async () => {
  const document = await loadFixture("vacancy-captcha.html");

  assert.equal(analyzeVacancyPage(document).state, "captcha");
});

test("detects lost login when apply button is absent and login is visible", async () => {
  const document = await loadFixture("vacancy-login-lost.html");

  assert.equal(analyzeVacancyPage(document).state, "login_lost");
});

test("detects success state after click", async () => {
  const document = await loadFixture("vacancy-success.html");

  assert.equal(analyzeVacancyPage(document).state, "success");
});

test("detects cover-letter modal as a known skip state", async () => {
  const document = await loadFixture("vacancy-cover-letter.html");

  assert.equal(analyzeVacancyPage(document).state, "requires_letter");
});

test("detects response popup with optional cover letter as ready to submit", async () => {
  const document = await loadFixture("vacancy-response-popup.html");

  assert.equal(analyzeVacancyPage(document).state, "response_ready");
  assert.equal(findResponseSubmitButton(document)?.textContent?.trim(), "Откликнуться");
});

test("detects response popup with disabled submit as manual action", async () => {
  const document = await loadFixture("vacancy-response-popup-disabled.html");
  const analysis = analyzeVacancyPage(document);

  assert.equal(analysis.state, "manual_action");
  assert.equal(analysis.notes, "response popup requires manual action");
  assert.equal(findResponseSubmitButton(document), null);
});

test("detects unknown modal as a safety stop state", async () => {
  const document = await loadFixture("vacancy-unknown-modal.html");

  assert.equal(analyzeVacancyPage(document).state, "unknown_modal");
});
