const SEARCH_URL = "https://duckduckgo.com/?q=";

const looksLikeHost = (text: string) => {
  const host = text.split(/[/?#]/, 1)[0] ?? "";
  return (
    /^localhost(:\d+)?$/i.test(host) ||
    /^\[[0-9a-f:.]+\](:\d+)?$/i.test(host) ||
    /^[^\s:]+\.[^\s:.]+(:\d+)?$/.test(host) ||
    /^[^\s:]+:\d+$/.test(host)
  );
};

export function withScheme(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
}

export function addressUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && looksLikeHost(text)) return `http://${text}`;
  return `${SEARCH_URL}${encodeURIComponent(text)}`;
}
