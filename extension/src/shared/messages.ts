import type { CandidateItem, VacancyResultStatus } from "./api";

export const SEARCH_CANDIDATES_PARSED = "HH_SEARCH_CANDIDATES_PARSED";
export const SEARCH_PARSE_REQUEST = "HH_SEARCH_PARSE_REQUEST";
export const POPUP_START_RUN = "HH_POPUP_START_RUN";
export const POPUP_STOP_RUN = "HH_POPUP_STOP_RUN";
export const POPUP_GET_STATUS = "HH_POPUP_GET_STATUS";
export const POPUP_CONFIRM_RESPONSE = "HH_POPUP_CONFIRM_RESPONSE";
export const VACANCY_APPLY_SIMPLE_REQUEST = "HH_VACANCY_APPLY_SIMPLE_REQUEST";
export const VACANCY_SUBMIT_COVER_LETTER_REQUEST =
  "HH_VACANCY_SUBMIT_COVER_LETTER_REQUEST";

export interface SearchCandidatesParsedMessage {
  type: typeof SEARCH_CANDIDATES_PARSED;
  pageUrl: string;
  parsedAt: string;
  candidates: CandidateItem[];
}

export interface SearchParseRequestMessage {
  type: typeof SEARCH_PARSE_REQUEST;
}

export interface SearchParseResponseMessage {
  pageUrl: string;
  parsedAt: string;
  candidates: CandidateItem[];
}

export interface PopupStartRunMessage {
  type: typeof POPUP_START_RUN;
}

export interface PopupStopRunMessage {
  type: typeof POPUP_STOP_RUN;
}

export interface PopupGetStatusMessage {
  type: typeof POPUP_GET_STATUS;
}

export type ConfirmDecision = "confirm" | "skip";

export interface PopupConfirmResponseMessage {
  type: typeof POPUP_CONFIRM_RESPONSE;
  vacancyId: string;
  decision: ConfirmDecision;
}

export interface PendingConfirmationView {
  vacancyId: string;
  title: string;
  employer: string;
  url: string;
}

export interface VacancyApplySimpleRequestMessage {
  type: typeof VACANCY_APPLY_SIMPLE_REQUEST;
  runId: string;
  vacancyId: string;
}

export interface VacancySubmitCoverLetterRequestMessage {
  type: typeof VACANCY_SUBMIT_COVER_LETTER_REQUEST;
  runId: string;
  vacancyId: string;
  body: string;
}

export type VacancyApplySimpleResponse =
  | {
      ok: true;
      status: VacancyResultStatus;
      vacancyTitle: string;
      employerName: string;
      vacancyDescription?: string;
      notes?: string;
    }
  | {
      ok: false;
      safety:
        | "captcha"
        | "login_lost"
        | "dom_mismatch"
        | "unknown_modal";
      vacancyTitle: string;
      employerName: string;
      vacancyDescription?: string;
      message: string;
      details?: Record<string, unknown>;
    };

export type ExtensionMessage =
  | SearchCandidatesParsedMessage
  | SearchParseRequestMessage
  | PopupStartRunMessage
  | PopupStopRunMessage
  | PopupGetStatusMessage
  | PopupConfirmResponseMessage
  | VacancyApplySimpleRequestMessage
  | VacancySubmitCoverLetterRequestMessage;

export function isSearchCandidatesParsedMessage(
  message: unknown
): message is SearchCandidatesParsedMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const value = message as Partial<SearchCandidatesParsedMessage>;
  return (
    value.type === SEARCH_CANDIDATES_PARSED &&
    typeof value.pageUrl === "string" &&
    typeof value.parsedAt === "string" &&
    Array.isArray(value.candidates)
  );
}

export function isSearchParseRequestMessage(
  message: unknown
): message is SearchParseRequestMessage {
  return hasType(message, SEARCH_PARSE_REQUEST);
}

export function isPopupStartRunMessage(
  message: unknown
): message is PopupStartRunMessage {
  return hasType(message, POPUP_START_RUN);
}

export function isPopupStopRunMessage(
  message: unknown
): message is PopupStopRunMessage {
  return hasType(message, POPUP_STOP_RUN);
}

export function isPopupGetStatusMessage(
  message: unknown
): message is PopupGetStatusMessage {
  return hasType(message, POPUP_GET_STATUS);
}

export function isPopupConfirmResponseMessage(
  message: unknown
): message is PopupConfirmResponseMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const value = message as Partial<PopupConfirmResponseMessage>;
  return (
    value.type === POPUP_CONFIRM_RESPONSE &&
    typeof value.vacancyId === "string" &&
    (value.decision === "confirm" || value.decision === "skip")
  );
}

export function isVacancyApplySimpleRequestMessage(
  message: unknown
): message is VacancyApplySimpleRequestMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const value = message as Partial<VacancyApplySimpleRequestMessage>;
  return (
    value.type === VACANCY_APPLY_SIMPLE_REQUEST &&
    typeof value.runId === "string" &&
    typeof value.vacancyId === "string"
  );
}

export function isVacancySubmitCoverLetterRequestMessage(
  message: unknown
): message is VacancySubmitCoverLetterRequestMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const value = message as Partial<VacancySubmitCoverLetterRequestMessage>;
  return (
    value.type === VACANCY_SUBMIT_COVER_LETTER_REQUEST &&
    typeof value.runId === "string" &&
    typeof value.vacancyId === "string" &&
    typeof value.body === "string"
  );
}

function hasType(message: unknown, type: string): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === type
  );
}
