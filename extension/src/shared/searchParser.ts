import type { CandidateItem } from "./api";
import { HH_SEARCH_SELECTORS } from "./selectors.ts";

type SearchRoot = Document | Element;

export function parseSearchCandidates(
  root: SearchRoot,
  baseUrl: string
): CandidateItem[] {
  const scope = root.querySelector(HH_SEARCH_SELECTORS.results) ?? root;
  const cards = Array.from(
    scope.querySelectorAll(HH_SEARCH_SELECTORS.vacancyCard)
  );

  return cards.flatMap((card) => {
    const candidate = parseCard(card, baseUrl);
    return candidate === null ? [] : [candidate];
  });
}

function parseCard(card: Element, baseUrl: string): CandidateItem | null {
  const titleLink = card.querySelector<HTMLAnchorElement>(
    HH_SEARCH_SELECTORS.titleLink
  );
  if (titleLink === null) {
    return null;
  }

  const rawVacancyUrl = titleLink.getAttribute("href") ?? "";
  const vacancyUrl = absoluteUrl(rawVacancyUrl, baseUrl);
  const responseHref =
    card
      .querySelector<HTMLAnchorElement>(HH_SEARCH_SELECTORS.responseLink)
      ?.getAttribute("href") ?? "";
  const vacancyId = extractVacancyId(card, rawVacancyUrl, responseHref);
  const title = textFrom(card, HH_SEARCH_SELECTORS.titleText, titleLink);

  if (vacancyId === "" || title === "" || vacancyUrl === "") {
    return null;
  }

  return {
    vacancyId,
    title,
    employerName: textFrom(
      card,
      HH_SEARCH_SELECTORS.employerText,
      card.querySelector(HH_SEARCH_SELECTORS.employerLink)
    ),
    vacancyUrl,
    hasTest: hasTest(card),
    isExternal: isExternal(card, responseHref, baseUrl),
    isArchived: isArchived(card),
    requiresLetter: requiresLetter(card)
  };
}

function extractVacancyId(
  card: Element,
  titleHref: string,
  responseHref: string
): string {
  const idElement = card.querySelector<HTMLElement>("[id]");
  if (idElement?.id !== undefined && /^\d+$/.test(idElement.id)) {
    return idElement.id;
  }

  return (
    extractVacancyIdFromUrl(titleHref) ??
    extractVacancyIdFromUrl(responseHref) ??
    ""
  );
}

function extractVacancyIdFromUrl(rawUrl: string): string | null {
  if (rawUrl === "") {
    return null;
  }

  const pathMatch = rawUrl.match(/\/vacancy\/(\d+)/);
  if (pathMatch?.[1] !== undefined) {
    return pathMatch[1];
  }

  try {
    const url = new URL(rawUrl, "https://hh.ru");
    return url.searchParams.get("vacancyId");
  } catch {
    return null;
  }
}

function hasTest(card: Element): boolean {
  if (card.querySelector(HH_SEARCH_SELECTORS.testMarker) !== null) {
    return true;
  }

  return /(?:требуется\s+)?тестовое\s+задание|вопросы\s+работодателя|пройти\s+тест/i.test(
    normalizedText(card)
  );
}

function isExternal(card: Element, responseHref: string, baseUrl: string): boolean {
  const response = card.querySelector(HH_SEARCH_SELECTORS.responseLink);
  if (/откликнуться\s+на\s+сайте\s+компании/i.test(normalizedText(response))) {
    return true;
  }
  if (/response_?url/i.test(responseHref)) {
    return true;
  }
  if (responseHref === "") {
    return false;
  }

  try {
    const responseUrl = new URL(responseHref, baseUrl);
    return responseUrl.hostname !== "" && responseUrl.hostname !== "hh.ru";
  } catch {
    return false;
  }
}

function isArchived(card: Element): boolean {
  if (card.querySelector(HH_SEARCH_SELECTORS.archivedMarker) !== null) {
    return true;
  }

  return /вакансия\s+в\s+архиве|архивная\s+вакансия/i.test(
    normalizedText(card)
  );
}

function requiresLetter(card: Element): boolean {
  if (card.querySelector(HH_SEARCH_SELECTORS.coverLetterMarker) !== null) {
    return true;
  }

  return /сопроводительное\s+письмо\s+обязательн|требуется\s+сопроводительное\s+письмо|cover\s+letter\s+required/i.test(
    normalizedText(card)
  );
}

function textFrom(
  root: Element,
  selector: string,
  fallback: Element | null
): string {
  return normalizedText(root.querySelector(selector) ?? fallback);
}

function normalizedText(element: Element | null): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(rawUrl: string, baseUrl: string): string {
  if (rawUrl === "") {
    return "";
  }

  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return rawUrl;
  }
}
