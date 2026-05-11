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
  notes?: string;
}

type VacancyRoot = Document | Element;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;

export function analyzeVacancyPage(root: VacancyRoot): VacancyPageAnalysis {
  const title = textFrom(root, HH_VACANCY_SELECTORS.title);
  const employerName = textFrom(root, HH_VACANCY_SELECTORS.employerName);
  const pageText = visibleText(root);

  if (root.querySelector(HH_VACANCY_SELECTORS.captcha) !== null) {
    return { state: "captcha", title, employerName };
  }
  if (isSuccess(root, pageText)) {
    return { state: "success", title, employerName };
  }
  if (requiresLetter(root, pageText)) {
    return { state: "requires_letter", title, employerName };
  }
  if (hasKnownTest(root, pageText)) {
    return { state: "skipped_test", title, employerName };
  }
  if (isAlreadyApplied(pageText)) {
    return { state: "skipped_already_applied", title, employerName };
  }
  if (isArchived(root, pageText)) {
    return { state: "skipped_archived", title, employerName };
  }
  if (!hasApplyButton(root) && root.querySelector(HH_VACANCY_SELECTORS.login) !== null) {
    return { state: "login_lost", title, employerName };
  }
  if (findResponseSubmitButton(root) !== null) {
    return { state: "response_ready", title, employerName };
  }
  if (hasResponsePopup(root)) {
    return {
      state: "manual_action",
      title,
      employerName,
      notes: "response popup requires manual action"
    };
  }
  if (hasUnknownModal(root)) {
    return {
      state: "unknown_modal",
      title,
      employerName,
      notes: "unknown modal is visible"
    };
  }
  if (!hasApplyButton(root)) {
    return {
      state: "dom_mismatch",
      title,
      employerName,
      notes: "apply button not found"
    };
  }

  return { state: "ready", title, employerName };
}

export function hasApplyButton(root: VacancyRoot): boolean {
  const applyButton = root.querySelector(HH_VACANCY_SELECTORS.applyButton);
  return applyButton !== null && /откликнуться/i.test(visibleText(applyButton));
}

export function findApplyButton(root: VacancyRoot): HTMLElement | null {
  const buttons = Array.from(
    root.querySelectorAll<HTMLElement>(HH_VACANCY_SELECTORS.applyButton)
  );
  return (
    buttons.find((button) => /откликнуться/i.test(visibleText(button))) ?? null
  );
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
