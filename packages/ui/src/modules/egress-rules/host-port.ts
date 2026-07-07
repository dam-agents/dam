/** Split a trailing `:port` from a host; 443 normalizes away, IPv6 left as-is.
 *  Index-based, not regex, to avoid ReDoS on user input. Mirrors the server. */
export function splitHostPort(raw: string): { host: string; port?: number } {
  const colon = raw.lastIndexOf(":");
  if (colon <= 0 || colon === raw.length - 1) return { host: raw };
  const host = raw.slice(0, colon);
  const portPart = raw.slice(colon + 1);
  if (host.includes(":")) return { host: raw }; // bare IPv6
  if (!/^[0-9]{1,5}$/.test(portPart)) return { host: raw };
  const port = Number(portPart);
  if (port < 1 || port > 65535) return { host: raw };
  return port === 443 ? { host } : { host, port };
}

/** Display form: `host[:port]`, the inverse of `splitHostPort`. */
export function formatHostPort(rule: { host: string; port?: number }): string {
  return rule.port ? `${rule.host}:${rule.port}` : rule.host;
}
