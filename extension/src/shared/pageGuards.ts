export function isHhSearchVacancyUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.hostname === "hh.ru" && url.pathname.startsWith("/search/vacancy");
  } catch {
    return false;
  }
}

export function isHhVacancyUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.hostname === "hh.ru" && /^\/vacancy\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isHhVacancyResponseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.hostname === "hh.ru" &&
      url.pathname === "/applicant/vacancy_response" &&
      url.searchParams.has("vacancyId")
    );
  } catch {
    return false;
  }
}

export function isHhVacancyRelatedUrl(rawUrl: string): boolean {
  return isHhVacancyUrl(rawUrl) || isHhVacancyResponseUrl(rawUrl);
}
