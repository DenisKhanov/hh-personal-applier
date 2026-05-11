import { parseSearchCandidates } from "../shared/searchParser";
import {
  SEARCH_CANDIDATES_PARSED,
  isSearchParseRequestMessage,
  type SearchCandidatesParsedMessage,
  type SearchParseResponseMessage
} from "../shared/messages";
import { isHhSearchVacancyUrl } from "../shared/pageGuards";

function parseAndSendCandidates(): void {
  if (!isHhSearchVacancyUrl(window.location.href)) {
    return;
  }

  const pageUrl = window.location.href;
  const message: SearchCandidatesParsedMessage = {
    type: SEARCH_CANDIDATES_PARSED,
    pageUrl,
    parsedAt: new Date().toISOString(),
    candidates: parseSearchCandidates(document, pageUrl)
  };

  console.log("[HH Personal Applier] parsed search candidates", {
    pageUrl: message.pageUrl,
    count: message.candidates.length
  });

  chrome.runtime.sendMessage(message, () => {
    if (chrome.runtime.lastError !== undefined) {
      console.log(
        "[HH Personal Applier] background did not accept parsed candidates",
        chrome.runtime.lastError.message
      );
    }
  });
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isSearchParseRequestMessage(message)) {
    return false;
  }

  const pageUrl = window.location.href;
  const response: SearchParseResponseMessage = {
    pageUrl,
    parsedAt: new Date().toISOString(),
    candidates: isHhSearchVacancyUrl(pageUrl)
      ? parseSearchCandidates(document, pageUrl)
      : []
  };
  sendResponse(response);
  return false;
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", parseAndSendCandidates, {
    once: true
  });
} else {
  parseAndSendCandidates();
}
