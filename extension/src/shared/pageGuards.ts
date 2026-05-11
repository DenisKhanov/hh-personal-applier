export function isHhSearchVacancyUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.hostname === "hh.ru" && url.pathname.startsWith("/search/vacancy");
  } catch {
    return false;
  }
}
