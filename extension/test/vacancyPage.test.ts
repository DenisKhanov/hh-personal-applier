import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHTML } from "linkedom";

import {
  analyzeVacancyPage,
  fillCoverLetterAndSubmit,
  findApplyButton,
  findCoverLetterTextarea,
  findResponseSubmitButton,
  hasApplyButton,
  vacancyDescription,
  waitForStableAnalysis,
  type VacancyPageAnalysis
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

test("detects already-applied state before generic success text", () => {
  const document = parseHTML(`
    <main>
      <h1 data-qa="vacancy-title">Go Backend Developer</h1>
      <div data-qa="vacancy-company-name">Acme Tech</div>
      <div>Отклик уже отправлен</div>
    </main>
  `).document;

  assert.equal(analyzeVacancyPage(document).state, "skipped_already_applied");
});

test("detects cover-letter modal as a known skip state", async () => {
  const document = await loadFixture("vacancy-cover-letter.html");

  const analysis = analyzeVacancyPage(document);
  assert.equal(analysis.state, "requires_letter");
  assert.match(analysis.description ?? "", /REST API/);
  assert.match(vacancyDescription(document), /PostgreSQL/);
});

test("fills required cover letter textarea and clicks submit", async () => {
  const document = await loadFixture("vacancy-cover-letter.html");
  const textarea = findCoverLetterTextarea(document);
  assert.notEqual(textarea, null);

  let clicked = false;
  findResponseSubmitButton(document)?.addEventListener("click", () => {
    clicked = true;
  });

  assert.equal(fillCoverLetterAndSubmit(document, "Generated cover letter"), true);
  assert.equal(textarea?.value, "Generated cover letter");
  assert.equal(clicked, true);
});

test("fills cover letter through native textarea setter before input events", async () => {
  const document = await loadFixture("vacancy-cover-letter.html");
  const textarea = findCoverLetterTextarea(document);
  assert.notEqual(textarea, null);
  if (textarea === null) {
    return;
  }

  const prototype = Object.getPrototypeOf(textarea) as HTMLTextAreaElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  assert.equal(typeof descriptor?.set, "function");
  assert.equal(typeof descriptor?.get, "function");

  let trackedValue = "";
  let inputObservedNativeChange = false;
  Object.defineProperty(textarea, "value", {
    configurable: true,
    get() {
      return descriptor?.get?.call(this) as string;
    },
    set(value: string) {
      trackedValue = value;
      descriptor?.set?.call(this, value);
    }
  });
  textarea.addEventListener("input", () => {
    inputObservedNativeChange = trackedValue !== textarea.value;
  });

  assert.equal(fillCoverLetterAndSubmit(document, "Generated cover letter"), true);
  assert.equal(textarea.value, "Generated cover letter");
  assert.equal(inputObservedNativeChange, true);
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

test("detects vacancy response page with employer questions as manual action", async () => {
  const document = await loadFixture("vacancy-response-questions.html");
  const analysis = analyzeVacancyPage(document);

  assert.equal(analysis.state, "manual_action");
  assert.equal(analysis.notes, "vacancy response page requires manual answers");
});

test("keeps employer questions on a regular vacancy page as skipped_test", async () => {
  const document = await loadFixture("vacancy-simple.html");
  const marker = document.createElement("p");
  marker.textContent = "Ответьте на вопросы работодателя";
  document.body.append(marker);

  assert.equal(analyzeVacancyPage(document).state, "skipped_test");
});

test("detects unknown modal as a safety stop state", async () => {
  const document = await loadFixture("vacancy-unknown-modal.html");

  assert.equal(analyzeVacancyPage(document).state, "unknown_modal");
});

test("waitForStableAnalysis retries while state stays dom_mismatch", async () => {
  const states: Array<VacancyPageAnalysis["state"]> = [
    "dom_mismatch",
    "dom_mismatch",
    "ready"
  ];
  let i = 0;
  let delayCalls = 0;

  const result = await waitForStableAnalysis(
    {
      analyze: (): VacancyPageAnalysis => ({
        state: states[i++] ?? "ready",
        title: "",
        employerName: ""
      }),
      async delay(): Promise<void> {
        delayCalls += 1;
      }
    },
    { timeoutMs: 1000, pollIntervalMs: 1 }
  );

  assert.equal(result.state, "ready");
  assert.equal(delayCalls, 2);
});

test("waitForStableAnalysis returns immediately for non-dom_mismatch state", async () => {
  let analyzeCalls = 0;

  const result = await waitForStableAnalysis({
    analyze: (): VacancyPageAnalysis => {
      analyzeCalls += 1;
      return { state: "captcha", title: "", employerName: "" };
    },
    async delay(): Promise<void> {}
  });

  assert.equal(result.state, "captcha");
  assert.equal(analyzeCalls, 1);
});

test("waitForStableAnalysis gives up after timeout with last dom_mismatch", async () => {
  const result = await waitForStableAnalysis(
    {
      analyze: (): VacancyPageAnalysis => ({
        state: "dom_mismatch",
        title: "",
        employerName: "",
        notes: "still loading"
      }),
      async delay(): Promise<void> {}
    },
    { timeoutMs: 30, pollIntervalMs: 1 }
  );

  assert.equal(result.state, "dom_mismatch");
  assert.equal(result.notes, "still loading");
});

test("findApplyButton returns the main vacancy button, not a recommended one", async () => {
  const document = await loadFixture("vacancy-with-recommended.html");

  const button = findApplyButton(document);
  assert.notEqual(button, null);
  // The main vacancy has vacancyId=111111111, recommended ones have 222222222 and 333333333.
  const href = button?.getAttribute("href") ?? "";
  assert.ok(href.includes("vacancyId=111111111"), `expected main vacancy button, got href=${href}`);
  assert.equal(hasApplyButton(document), true);
  assert.equal(analyzeVacancyPage(document).state, "ready");
});
