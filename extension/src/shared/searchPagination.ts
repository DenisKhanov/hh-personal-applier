export function nextSearchPageUrl(pageUrl: string): string {
  const url = new URL(pageUrl);
  const currentPage = Number.parseInt(url.searchParams.get("page") ?? "0", 10);
  const nextPage = Number.isFinite(currentPage) && currentPage >= 0
    ? currentPage + 1
    : 1;
  url.searchParams.set("page", String(nextPage));
  return url.toString();
}
