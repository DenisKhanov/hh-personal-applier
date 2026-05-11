import type { CandidateItem } from "./api";

export const SEARCH_CANDIDATES_PARSED = "HH_SEARCH_CANDIDATES_PARSED";

export interface SearchCandidatesParsedMessage {
  type: typeof SEARCH_CANDIDATES_PARSED;
  pageUrl: string;
  parsedAt: string;
  candidates: CandidateItem[];
}

export type ExtensionMessage = SearchCandidatesParsedMessage;

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
