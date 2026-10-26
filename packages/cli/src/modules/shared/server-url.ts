export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  const url = URL.canParse(trimmed) ? new URL(trimmed) : undefined;
  if (url === undefined || !/^https?:$/.test(url.protocol)) {
    return trimmed.replace(/\/+$/, "");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
