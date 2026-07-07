/** Split a trailing `:port` from a user-typed host ("api.cluster.example:6443").
 *  443 normalizes away (it's the default everywhere downstream); strings with
 *  another colon (IPv6) are left untouched. Parsed by string index rather than
 *  a backtracking regex so a hostile host can't drive superlinear matching. */
export function splitHostPort(raw: string): { host: string; port?: number } {
  const colon = raw.lastIndexOf(":");
  if (colon <= 0 || colon === raw.length - 1) return { host: raw };
  const host = raw.slice(0, colon);
  const portPart = raw.slice(colon + 1);
  // A colon in the host part means a bare IPv6 literal — leave it untouched.
  if (host.includes(":")) return { host: raw };
  // Bounded, anchored — no backtracking risk.
  if (!/^[0-9]{1,5}$/.test(portPart)) return { host: raw };
  const port = Number(portPart);
  if (port < 1 || port > 65535) return { host: raw };
  return port === 443 ? { host } : { host, port };
}

/** Display form: `host[:port]`, the inverse of `splitHostPort`. */
export function formatHostPort(rule: { host: string; port?: number }): string {
  return rule.port ? `${rule.host}:${rule.port}` : rule.host;
}
