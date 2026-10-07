export function wsUrl(host: string, path: string, token: string): string {
  const proto = host.startsWith("https://") ? "wss:" : "ws:";
  const base = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const sep = path.includes("?") ? "&" : "?";
  return `${proto}//${base}${path}${sep}token=${encodeURIComponent(token)}`;
}
