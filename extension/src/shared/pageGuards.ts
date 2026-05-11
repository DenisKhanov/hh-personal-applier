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
