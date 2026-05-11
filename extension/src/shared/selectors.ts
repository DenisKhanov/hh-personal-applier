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
