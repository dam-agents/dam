import type { EnvironmentRecord } from "./environment.js";

// UNIT_BOUNDARY_DESCRIPTION: the path every Environment address reserves for the hand-off of its session and its sign-out; the relay never forwards it to the app.
export const RESERVED_PREFIX = "/.platform/";

// UNIT_BOUNDARY_DESCRIPTION: a visitor's session on one Environment address, in a `__Host-` cookie (https) that the browser sends to that exact origin only, so no other Environment or platform host can set or read it. Over plain http (the local cluster) the prefix cannot be used, and the cookie is host-only anyway.
export const SESSION_COOKIE_SECURE = "__Host-platform-env";
export const SESSION_COOKIE_PLAIN = "platform-env";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface EnvironmentSession {
  sub: string;
  email: string | null;
  address: string;
  createdAt: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a cookie, as one `name=value` pair of a
 * `Cookie` header or the start of a `Set-Cookie` header, is one of the
 * platform's session cookies. The name is compared once trimmed, as a browser
 * stores it, so a padded name (`platform-env =x`) is the session cookie too.
 */
export function isSessionCookie(cookie: string): boolean {
  const name = cookie.split("=", 1)[0]!.trim();
  return name === SESSION_COOKIE_SECURE || name === SESSION_COOKIE_PLAIN;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An app's `Set-Cookie` as the visitor gets it, or
 * null when it may not pass: the platform's session cookie never does, and
 * any other loses its `Domain` attribute, so the cookie stays on the address
 * that set it. Every address shares the environments domain, and a cookie
 * set for that domain would reach every other Environment's app.
 */
export function appSetCookie(cookie: string): string | null {
  if (isSessionCookie(cookie)) return null;
  return cookie
    .split(";")
    .filter((part, i) => i === 0 || !/^\s*domain\s*=/i.test(part))
    .join(";");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The value of the cookie `name` in a `Cookie`
 * header, by the trimmed name of each pair, or undefined.
 */
export function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const pair of (header ?? "").split(";")) {
    const eq = pair.indexOf("=");
    if (eq !== -1 && pair.slice(0, eq).trim() === name)
      return pair.slice(eq + 1).trim();
  }
  return undefined;
}

export interface ParsedAddress {
  address: string;
  endpoint: string;
  host: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Environment address a Host header names, or
 * null for any other host. The address is the first DNS label under the
 * install's environments domain, `<endpoint>-<host>`; an endpoint name has no
 * hyphen, so the first hyphen splits it from the Environment's host label.
 * A port in the header is ignored, and a label with anything but lowercase
 * letters, digits and hyphens is no address.
 */
export function parseAddress(
  hostHeader: string | undefined,
  domain: string,
): ParsedAddress | null {
  const hostname = hostHeader?.split(":")[0]?.toLowerCase();
  const suffix = `.${domain.toLowerCase()}`;
  if (!hostname?.endsWith(suffix)) return null;
  const address = hostname.slice(0, -suffix.length);
  if (!/^[a-z0-9-]{1,63}$/.test(address)) return null;
  const dash = address.indexOf("-");
  if (dash <= 0 || dash === address.length - 1) return null;
  return {
    address,
    endpoint: address.slice(0, dash),
    host: address.slice(dash + 1),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The environments domain an endpoint URL template
 * (`<scheme>://{host}.<domain>[:port]`) names, or null when the install serves
 * no Environments.
 */
export function domainOf(urlTemplate: string | null): string | null {
  if (urlTemplate === null) return null;
  try {
    const hostname = new URL(urlTemplate.replace("{host}", "x")).hostname;
    return hostname.startsWith("x.") ? hostname.slice(2) : null;
  } catch {
    return null;
  }
}

export type AccessDecision =
  { allow: true } | { allow: false; reason: "not-signed-in" | "not-allowed" };

/**
 * UNIT_BOUNDARY_DESCRIPTION: The people who may open one Environment: those on
 * its owner's list for the owning agent, narrowed to the Environment's own
 * list when its agent set one. The agent can only narrow: an email on the
 * Environment's list but not on the owner's opens nothing. Emails compare
 * trimmed and lowercased.
 */
export function effectiveAccess(
  ownerList: readonly string[],
  environmentList: readonly string[] | null,
): string[] {
  const normalize = (e: string) => e.trim().toLowerCase();
  const owners = ownerList.map(normalize);
  if (environmentList === null) return owners;
  const narrowed = new Set(environmentList.map(normalize));
  return owners.filter((e) => narrowed.has(e));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Who may open an Environment. Its owner always,
 * and anyone whose identity provider verified an email on the effective list.
 * A session made for another address counts as no session, so a cookie
 * carried to another Environment opens nothing; a session without a verified
 * email matches no list.
 */
export function decideAccess(
  record: Pick<EnvironmentRecord, "owner">,
  allowed: readonly string[],
  session: EnvironmentSession | null,
  address: string,
): AccessDecision {
  if (!session || session.address !== address)
    return { allow: false, reason: "not-signed-in" };
  if (session.sub === record.owner) return { allow: true };
  const email = session.email?.trim().toLowerCase();
  if (email && allowed.includes(email)) return { allow: true };
  return { allow: false, reason: "not-allowed" };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A sign-in's return path on the address it began
 * on: a path of that origin, never another host.
 */
export function safeNext(path: string | undefined): string {
  if (
    path === undefined ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith(RESERVED_PREFIX) ||
    /[\r\n\\]/.test(path)
  )
    return "/";
  return path;
}

// UNIT_BOUNDARY_DESCRIPTION: the request headers the relay never passes on: the platform's own credentials, and the headers that only describe this hop.
const DROPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "host",
  "connection",
  "proxy-authorization",
  "x-platform-environment-ports",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: The headers an Environment's app gets. The
 * platform's session cookies are dropped and every other cookie passes, so the
 * app sees only cookies it set itself on its own address; `Authorization` is
 * dropped too, since a platform token must never reach a build. The original
 * host and scheme go on as the usual forwarded headers, for an app that builds
 * its own URLs.
 */
export function relayHeaders(
  incoming: Headers,
  opts: { address: string; publicHost: string; scheme: string },
): Headers {
  const out = new Headers();
  for (const [name, value] of incoming) {
    if (DROPPED_REQUEST_HEADERS.has(name)) continue;
    if (name === "cookie") {
      const kept = value
        .split(";")
        .map((c) => c.trim())
        .filter((c) => c !== "" && !isSessionCookie(c));
      if (kept.length > 0) out.set("cookie", kept.join("; "));
      continue;
    }
    out.append(name, value);
  }
  out.set("x-forwarded-host", opts.publicHost);
  out.set("x-forwarded-proto", opts.scheme);
  return out;
}
