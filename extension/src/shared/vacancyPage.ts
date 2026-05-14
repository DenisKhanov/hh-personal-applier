import { HH_VACANCY_SELECTORS } from "./selectors.ts";

export type VacancyPageState =
  | "ready"
  | "captcha"
  | "login_lost"
  | "success"
  | "response_ready"
  | "requires_letter"
  | "manual_action"
  | "skipped_test"
  | "skipped_already_applied"
  | "skipped_archived"
  | "dom_mismatch"
  | "unknown_modal";

export interface VacancyPageAnalysis {
  state: VacancyPageState;
  title: string;
  employerName: string;
  description?: string;
  notes?: string;
}

export interface AnalysisProbe {
  analyze(): VacancyPageAnalysis;
  delay(ms: number): Promise<void>;
}

export interface WaitForStableAnalysisOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_STABILIZE_TIMEOUT_MS = 3000;
const DEFAULT_STABILIZE_POLL_MS = 200;

// Retries analyzeVacancyPage while the state is "dom_mismatch" — the page may
// still be hydrating late after document_idle. Any non-dom_mismatch state is
// returned immediately so legitimate skips/safety stops are not delayed.
export async function waitForStableAnalysis(
  probe: AnalysisProbe,
  options: WaitForStableAnalysisOptions = {}
): Promise<VacancyPageAnalysis> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STABILIZE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_STABILIZE_POLL_MS;
  const deadline = Date.now() + timeoutMs;

  let analysis = probe.analyze();
  while (Date.now() < deadline && analysis.state === "dom_mismatch") {
    await probe.delay(pollIntervalMs);
    analysis = probe.analyze();
  }
  return analysis;
}

type VacancyRoot = Document | Element;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;

export function analyzeVacancyPage(root: VacancyRoot): VacancyPageAnalysis {
  const title = textFrom(root, HH_VACANCY_SELECTORS.title);
  const employerName = textFrom(root, HH_VACANCY_SELECTORS.employerName);
  const description = vacancyDescription(root);
  const common =
    description === ""
      ? { title, employerName }
      : { title, employerName, description };
  const pageText = visibleText(root);

  if (root.querySelector(HH_VACANCY_SELECTORS.captcha) !== null) {
    return { state: "captcha", ...common };
  }
  if (isAlreadyApplied(pageText)) {
    return { state: "skipped_already_applied", ...common };
  }
  if (isSuccess(root, pageText)) {
    return { state: "success", ...common };
  }
  if (requiresLetter(root, pageText)) {
    return { state: "requires_letter", ...common };
  }
  if (hasResponseQuestions(root, pageText)) {
    return {
      state: "manual_action",
      ...common,
      notes: "vacancy response page requires manual answers"
    };
  }
  if (hasKnownTest(root, pageText)) {
    return { state: "skipped_test", ...common };
  }
  if (isArchived(root, pageText)) {
    return { state: "skipped_archived", ...common };
  }
  if (!hasApplyButton(root) && root.querySelector(HH_VACANCY_SELECTORS.login) !== null) {
    return { state: "login_lost", ...common };
  }
  if (findResponseSubmitButton(root) !== null) {
    return { state: "response_ready", ...common };
  }
  if (hasResponsePopup(root)) {
    return {
      state: "manual_action",
      ...common,
      notes: "response popup requires manual action"
    };
  }
  if (hasUnknownModal(root)) {
    return {
      state: "unknown_modal",
      ...common,
      notes: "unknown modal is visible"
    };
  }
  if (!hasApplyButton(root)) {
    return {
      state: "dom_mismatch",
      ...common,
      notes: "apply button not found"
    };
  }

  return { state: "ready", ...common };
}

export function hasApplyButton(root: VacancyRoot): boolean {
  const scope = mainVacancyScope(root);
  const applyButton = scope.querySelector(HH_VACANCY_SELECTORS.applyButton);
  return applyButton !== null && /откликнуться/i.test(visibleText(applyButton));
}

export function findApplyButton(root: VacancyRoot): HTMLElement | null {
  const scope = mainVacancyScope(root);
  const buttons = Array.from(
    scope.querySelectorAll<HTMLElement>(HH_VACANCY_SELECTORS.applyButton)
  );
  return (
    buttons.find((button) => /откликнуться/i.test(visibleText(button))) ?? null
  );
}

function mainVacancyScope(root: VacancyRoot): Element {
  // Find the main vacancy section that contains the title — this excludes
  // the "Вам подойдут эти вакансии" recommended-vacancies section at the
  // bottom of the page whose "Откликнуться" buttons belong to other vacancies.
  const titleElement = root.querySelector(HH_VACANCY_SELECTORS.title);
  if (titleElement === null) {
    // No title found — fall back to the whole root (or the first mainSection).
    const section = root.querySelector(HH_VACANCY_SELECTORS.mainSection);
    return section ?? (isDocumentRoot(root) ? root.documentElement : root);
  }

  // Walk up from the title to find a section-level ancestor that contains
  // the apply button. Stop before reaching <body> or <html>.
  let ancestor: Element | null = titleElement.parentElement;
  while (ancestor !== null) {
    if (ancestor.matches(HH_VACANCY_SELECTORS.mainSection)) {
      return ancestor;
    }
    if (ancestor.tagName === "BODY" || ancestor.tagName === "HTML") {
      break;
    }
    ancestor = ancestor.parentElement;
  }

  // Fallback: return the title's closest section-level parent that contains
  // an apply button, or the title's parent if nothing else works.
  let candidate: Element | null = titleElement.parentElement;
  while (candidate !== null && candidate.parentElement !== null) {
    if (candidate.parentElement.tagName === "BODY" || candidate.parentElement.tagName === "HTML") {
      break;
    }
    if (candidate.querySelector(HH_VACANCY_SELECTORS.applyButton) !== null) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }

  return candidate ?? titleElement.parentElement ?? (isDocumentRoot(root) ? root.documentElement : root);
}

export function findResponseSubmitButton(root: VacancyRoot): HTMLElement | null {
  const scopedCandidates = responsePopupElements(root).flatMap((popup) =>
    buttonCandidates(popup)
  );
  const fallbackCandidates = buttonCandidates(root).filter((candidate) =>
    candidate.matches(HH_VACANCY_SELECTORS.responseSubmitButton)
  );

  return uniqueElements([...scopedCandidates, ...fallbackCandidates]).find(
    (candidate) => isEnabled(candidate) && isResponseSubmitText(buttonText(candidate))
  ) ?? null;
}

export function findCoverLetterTextarea(root: VacancyRoot): HTMLTextAreaElement | null {
  return root.querySelector<HTMLTextAreaElement>(HH_VACANCY_SELECTORS.coverLetterInput);
}

export function fillCoverLetterAndSubmit(root: VacancyRoot, body: string): boolean {
  const textarea = findCoverLetterTextarea(root);
  const submitButton = findResponseSubmitButton(root);
  if (textarea === null || submitButton === null) {
    return false;
  }

  setNativeTextareaValue(textarea, body);
  dispatchTextareaEvent(textarea, "input");
  dispatchTextareaEvent(textarea, "change");
  submitButton.click();
  return true;
}

export function vacancyDescription(root: VacancyRoot): string {
  return textFrom(root, HH_VACANCY_SELECTORS.description);
}

function dispatchTextareaEvent(textarea: HTMLTextAreaElement, type: string): void {
  const eventCtor = textarea.ownerDocument.defaultView?.Event ?? Event;
  textarea.dispatchEvent(new eventCtor(type, { bubbles: true }));
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const prototype = textarea.ownerDocument.defaultView?.HTMLTextAreaElement?.prototype;
  const descriptor =
    prototype === undefined
      ? undefined
      : Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor?.set !== undefined) {
    descriptor.set.call(textarea, value);
    return;
  }
  textarea.value = value;
}

export function visibleText(root: VacancyRoot | null): string {
  if (root === null) {
    return "";
  }

  const parts: string[] = [];
  collectVisibleText(root, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function collectVisibleText(node: Node, parts: string[]): void {
  if (node.nodeType === TEXT_NODE) {
    const text = node.textContent?.trim();
    if (text !== undefined && text !== "") {
      parts.push(text);
    }
    return;
  }

  if (node.nodeType !== ELEMENT_NODE && node.nodeType !== DOCUMENT_NODE) {
    return;
  }

  if (node.nodeType === ELEMENT_NODE) {
    const element = node as Element;
    if (shouldSkipText(element)) {
      return;
    }
  }

  node.childNodes.forEach((child) => {
    collectVisibleText(child, parts);
  });
}

function shouldSkipText(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return (
    tagName === "script" ||
    tagName === "style" ||
    tagName === "template" ||
    tagName === "noscript" ||
    element.getAttribute("aria-hidden") === "true" ||
    element.hasAttribute("hidden")
  );
}

function textFrom(root: VacancyRoot, selector: string): string {
  return visibleText(root.querySelector(selector));
}

function isSuccess(root: VacancyRoot, pageText: string): boolean {
  return (
    root.querySelector(HH_VACANCY_SELECTORS.success) !== null ||
    /отклик\s+отправлен|вы\s+откликнулись|отклик\s+уже\s+отправлен/i.test(pageText)
  );
}

function requiresLetter(root: VacancyRoot, pageText: string): boolean {
  return (
    root.querySelector(HH_VACANCY_SELECTORS.coverLetter) !== null ||
    /сопроводительное\s+письмо\s+обязательн|требуется\s+сопроводительное\s+письмо/i.test(
      pageText
    )
  );
}

function hasKnownTest(root: VacancyRoot, pageText: string): boolean {
  return (
    root.querySelector(HH_VACANCY_SELECTORS.test) !== null ||
    /тестовое\s+задание|вопросы\s+работодателя|ответьте\s+на\s+вопросы/i.test(
      pageText
    )
  );
}

function hasResponseQuestions(root: VacancyRoot, pageText: string): boolean {
  const hasQuestionField =
    root.querySelector(HH_VACANCY_SELECTORS.responseQuestion) !== null;
  const mentionsEmployerQuestions =
    /вопросы\s+работодателя|ответьте\s+на\s+вопросы|ответьте\s+на\s+вопрос/i.test(
      pageText
    );
  if (!hasQuestionField && !mentionsEmployerQuestions) {
    return false;
  }

  const hasResponseForm =
    root.querySelector(
      '[data-qa*="vacancy-response-form"], [data-qa*="vacancy-response-question"], [data-qa*="response-question"], form[action*="/applicant/vacancy_response"]'
    ) !== null;
  return hasResponseForm || isVacancyResponseDocument(root);
}

function isVacancyResponseDocument(root: VacancyRoot): boolean {
  const document = isDocumentRoot(root) ? root : root.ownerDocument;
  const href = document?.location?.href ?? "";
  try {
    const url = new URL(href);
    return url.hostname === "hh.ru" && url.pathname === "/applicant/vacancy_response";
  } catch {
    return href.includes("/applicant/vacancy_response");
  }
}

function isDocumentRoot(root: VacancyRoot): root is Document {
  return root.nodeType === DOCUMENT_NODE;
}

function isAlreadyApplied(pageText: string): boolean {
  return /вы\s+уже\s+откликались|отклик\s+уже\s+отправлен/i.test(pageText);
}

function isArchived(root: VacancyRoot, pageText: string): boolean {
  return (
    root.querySelector(HH_VACANCY_SELECTORS.archived) !== null ||
    /вакансия\s+в\s+архиве|архивная\s+вакансия/i.test(pageText)
  );
}

function hasUnknownModal(root: VacancyRoot): boolean {
  const modals = Array.from(root.querySelectorAll(HH_VACANCY_SELECTORS.modal));
  return modals.some((modal) => {
    if (modal.querySelector(HH_VACANCY_SELECTORS.coverLetter) !== null) {
      return false;
    }
    if (isResponsePopup(modal)) {
      return false;
    }
    return visibleText(modal) !== "";
  });
}

function hasResponsePopup(root: VacancyRoot): boolean {
  return responsePopupElements(root).length > 0;
}

function responsePopupElements(root: VacancyRoot): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(HH_VACANCY_SELECTORS.responsePopup)
  ).filter(isResponsePopup);
}

function isResponsePopup(element: Element): boolean {
  const dataQa = element.getAttribute("data-qa") ?? "";
  return (
    /vacancy-response-popup/i.test(dataQa) ||
    /резюме|сопроводительн|отклик/i.test(visibleText(element))
  );
}

function buttonCandidates(root: VacancyRoot): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      `${HH_VACANCY_SELECTORS.responseSubmitButton}, button, a, [role="button"], input[type="submit"], input[type="button"]`
    )
  );
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
  return Array.from(new Set(elements));
}

function isEnabled(element: HTMLElement): boolean {
  const maybeDisabled = element as HTMLElement & { disabled?: boolean };
  return (
    maybeDisabled.disabled !== true &&
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-disabled") !== "true" &&
    !element.classList.contains("bloko-button_disabled")
  );
}

function buttonText(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  const value =
    tagName === "input" || tagName === "button"
      ? (element as HTMLInputElement | HTMLButtonElement).value
      : "";
  return `${visibleText(element)} ${value} ${element.getAttribute("aria-label") ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
}

function isResponseSubmitText(text: string): boolean {
  return /(^|\s)(откликнуться|отправить\s+отклик|подтвердить)(\s|$)/i.test(text);
}
