import {
  isVacancyApplySimpleRequestMessage,
  isVacancySubmitCoverLetterRequestMessage,
  type VacancyApplySimpleResponse
} from "../shared/messages";
import { isHhVacancyRelatedUrl } from "../shared/pageGuards";
import type { VacancyResultStatus } from "../shared/api";
import {
  analyzeVacancyPage,
  fillCoverLetterAndSubmit,
  findApplyButton,
  findResponseSubmitButton,
  waitForStableAnalysis,
  type VacancyPageAnalysis
} from "../shared/vacancyPage";

const APPLY_OUTCOME_TIMEOUT_MS = 8000;
const APPLY_OUTCOME_POLL_MS = 250;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isVacancyApplySimpleRequestMessage(message)) {
    if (!isVacancySubmitCoverLetterRequestMessage(message)) {
      return false;
    }

    void submitCoverLetter(message.body)
      .then(sendResponse)
      .catch((error: unknown) => {
        const analysis = analyzeVacancyPage(document);
        sendResponse(
          safetyResponse(
            "unknown_modal",
            analysis,
            error instanceof Error ? error.message : "Cover letter submit failed"
          )
        );
      });
    return true;
  }

  void applySimpleVacancy()
    .then(sendResponse)
    .catch((error: unknown) => {
      const analysis = analyzeVacancyPage(document);
      sendResponse(
        safetyResponse(
          "unknown_modal",
          analysis,
          error instanceof Error ? error.message : "Apply command failed"
        )
      );
    });

  return true;
});

async function applySimpleVacancy(): Promise<VacancyApplySimpleResponse> {
  if (!isHhVacancyRelatedUrl(window.location.href)) {
    return safetyResponse(
      "dom_mismatch",
      analyzeVacancyPage(document),
      "active page is not an hh.ru vacancy"
    );
  }

  const beforeClick = await waitForStableAnalysis({
    analyze: () => analyzeVacancyPage(document),
    delay
  });
  const beforeClickOutcome = outcomeFromAnalysis(beforeClick);
  if (beforeClickOutcome !== null) {
    return beforeClickOutcome;
  }

  // On /applicant/vacancy_response pages the apply button was already clicked
  // (it caused the navigation). If the response form is ready, submit directly.
  if (beforeClick.state === "response_ready") {
    const submitButton = findResponseSubmitButton(document);
    if (submitButton === null) {
      return safetyResponse(
        "dom_mismatch",
        beforeClick,
        "response submit button not found on response page"
      );
    }

    submitButton.click();

    const afterSubmit = await waitForSubmitOutcome();
    const afterSubmitOutcome = outcomeFromAnalysis(afterSubmit);
    if (afterSubmitOutcome !== null) {
      return afterSubmitOutcome;
    }

    return okResponse(
      "applied",
      afterSubmit,
      "response submit clicked; no error state detected"
    );
  }

  const applyButton = findApplyButton(document);
  if (applyButton === null) {
    return safetyResponse("dom_mismatch", beforeClick, "apply button not found");
  }

  applyButton.click();

  const afterClick = await waitForPostClickOutcome();
  const afterClickOutcome = outcomeFromAnalysis(afterClick);
  if (afterClickOutcome !== null) {
    return afterClickOutcome;
  }

  if (afterClick.state === "response_ready") {
    const submitButton = findResponseSubmitButton(document);
    if (submitButton === null) {
      return safetyResponse(
        "dom_mismatch",
        afterClick,
        "response submit button not found"
      );
    }

    submitButton.click();

    const afterSubmit = await waitForSubmitOutcome();
    const afterSubmitOutcome = outcomeFromAnalysis(afterSubmit);
    if (afterSubmitOutcome !== null) {
      return afterSubmitOutcome;
    }

    return okResponse(
      "applied",
      afterSubmit,
      "response submit clicked; no error state detected"
    );
  }

  return {
    ok: true,
    status: "unknown_after_click",
    vacancyTitle: afterClick.title,
    employerName: afterClick.employerName,
    notes: "no known success or skip state after click"
  };
}

async function submitCoverLetter(body: string): Promise<VacancyApplySimpleResponse> {
  const beforeSubmit = analyzeVacancyPage(document);
  if (beforeSubmit.state !== "requires_letter" && beforeSubmit.state !== "response_ready") {
    const beforeSubmitOutcome = outcomeFromAnalysis(beforeSubmit);
    if (beforeSubmitOutcome !== null) {
      return beforeSubmitOutcome;
    }
  }

  if (!fillCoverLetterAndSubmit(document, body)) {
    return safetyResponse(
      "dom_mismatch",
      beforeSubmit,
      "cover letter textarea or submit button not found"
    );
  }

  const afterSubmit = await waitForSubmitOutcome();
  const afterSubmitOutcome = outcomeFromAnalysis(afterSubmit);
  if (afterSubmitOutcome !== null) {
    return afterSubmitOutcome;
  }

  return okResponse(
    "applied",
    afterSubmit,
    "cover letter submit clicked; no error state detected"
  );
}

async function waitForPostClickOutcome(): Promise<VacancyPageAnalysis> {
  const deadline = Date.now() + APPLY_OUTCOME_TIMEOUT_MS;
  let lastAnalysis = analyzeVacancyPage(document);

  while (Date.now() < deadline) {
    lastAnalysis = analyzeVacancyPage(document);
    if (lastAnalysis.state !== "ready") {
      return lastAnalysis;
    }
    await delay(APPLY_OUTCOME_POLL_MS);
  }

  return lastAnalysis;
}

async function waitForSubmitOutcome(): Promise<VacancyPageAnalysis> {
  const deadline = Date.now() + APPLY_OUTCOME_TIMEOUT_MS;
  let lastAnalysis = analyzeVacancyPage(document);

  while (Date.now() < deadline) {
    lastAnalysis = analyzeVacancyPage(document);
    if (
      lastAnalysis.state !== "ready" &&
      lastAnalysis.state !== "response_ready" &&
      lastAnalysis.state !== "requires_letter"
    ) {
      return lastAnalysis;
    }
    await delay(APPLY_OUTCOME_POLL_MS);
  }

  return lastAnalysis;
}

function outcomeFromAnalysis(
  analysis: VacancyPageAnalysis
): VacancyApplySimpleResponse | null {
  switch (analysis.state) {
    case "ready":
    case "response_ready":
      return null;
    case "success":
      return okResponse("applied", analysis);
    case "requires_letter":
      return okResponse(
        "skipped_cover_letter",
        analysis,
        "cover letter is required"
      );
    case "manual_action":
      return okResponse(
        "manual_action",
        analysis,
        analysis.notes ?? "manual action required"
      );
    case "skipped_test":
      return okResponse("skipped_test", analysis, "test or employer questions");
    case "skipped_already_applied":
      return okResponse("skipped_already_applied", analysis);
    case "skipped_archived":
      return okResponse("skipped_archived", analysis);
    case "captcha":
      return safetyResponse("captcha", analysis, "CAPTCHA detected");
    case "login_lost":
      return safetyResponse("login_lost", analysis, "login lost");
    case "dom_mismatch":
      return safetyResponse(
        "dom_mismatch",
        analysis,
        analysis.notes ?? "vacancy DOM mismatch"
      );
    case "unknown_modal":
      // Pipeline §7.2: unknown modal halts the cycle. The unknown_after_click
      // fallback below (when waitForPostClickOutcome saw no visible change)
      // covers §15.1 — that path stays a continue, this one is a safety stop.
      return safetyResponse(
        "unknown_modal",
        analysis,
        analysis.notes ?? "unknown modal after click"
      );
  }
}

function okResponse(
  status: VacancyResultStatus,
  analysis: VacancyPageAnalysis,
  notes?: string
): VacancyApplySimpleResponse {
  return {
    ok: true,
    status,
    vacancyTitle: analysis.title,
    employerName: analysis.employerName,
    ...(analysis.description === undefined
      ? {}
      : { vacancyDescription: analysis.description }),
    ...(notes === undefined ? {} : { notes })
  };
}

function safetyResponse(
  safety: "captcha" | "login_lost" | "dom_mismatch" | "unknown_modal",
  analysis: VacancyPageAnalysis,
  message: string
): VacancyApplySimpleResponse {
  return {
    ok: false,
    safety,
    vacancyTitle: analysis.title,
    employerName: analysis.employerName,
    ...(analysis.description === undefined
      ? {}
      : { vacancyDescription: analysis.description }),
    message,
    details: {
      state: analysis.state,
      notes: analysis.notes ?? ""
    }
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
