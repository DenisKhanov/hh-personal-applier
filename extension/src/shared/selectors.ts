export const HH_SEARCH_SELECTORS = {
  results: '[data-qa="vacancy-serp__results"]',
  vacancyCard: '[data-qa="vacancy-serp__vacancy"]',
  titleLink: 'a[data-qa="serp-item__title"]',
  titleText: '[data-qa="serp-item__title-text"]',
  employerLink: '[data-qa="vacancy-serp__vacancy-employer"]',
  employerText: '[data-qa="vacancy-serp__vacancy-employer-text"]',
  responseLink: '[data-qa="vacancy-serp__vacancy_response"]',
  testMarker: '[data-qa*="test"], [data-qa*="question"]',
  archivedMarker: '[data-qa*="archiv"], [data-qa*="archive"]',
  coverLetterMarker:
    '[data-qa*="cover-letter"], [data-qa*="letter"], [data-qa*="soprovod"]'
} as const;

export const HH_VACANCY_SELECTORS = {
  title: '[data-qa="vacancy-title"]',
  employerName: '[data-qa="vacancy-company-name"]',
  description:
    '[data-qa="vacancy-description"], [data-qa="vacancy-section-description"], [data-qa*="vacancy-description"]',
  mainSection: '[data-qa="vacancy-title"], .vacancy-title, .vacancy-body, .vacancy-section',
  applyButton:
    '[data-qa="vacancy-response-link-top"], [data-qa="vacancy-response-link-bottom"]',
  success:
    '[data-qa*="vacancy-response-success"], [data-qa*="response-success"]',
  captcha:
    '[data-qa*="captcha"], form[action*="captcha"], iframe[src*="captcha"]',
  login: '[data-qa="login"], [data-qa="mainmenu_profile-link"]',
  coverLetter:
    '[data-qa="vacancy-response-popup-form-letter-input"][required], [data-qa="vacancy-response-popup-form-letter-input"][aria-required="true"], [aria-required="true"][data-qa*="letter"]',
  coverLetterInput:
    '[data-qa="vacancy-response-popup-form-letter-input"], textarea[name*="letter"], textarea[id*="letter"]',
  responsePopup: '[data-qa*="vacancy-response-popup"], [role="dialog"], .bloko-modal',
  responseSubmitButton:
    '[data-qa="vacancy-response-submit-popup"], [data-qa*="vacancy-response-submit"], [data-qa*="response-submit"]',
  responseQuestion:
    '[data-qa*="vacancy-response-question"], [data-qa*="response-question"], textarea[name*="question"], input[name*="question"]',
  modal: '[role="dialog"], [data-qa*="popup"], .bloko-modal',
  archived: '[data-qa*="archiv"], [data-qa*="archive"]',
  test: '[data-qa*="response-test"], [data-qa*="test-required"]'
} as const;
