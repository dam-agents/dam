import type { EnvironmentRecord } from "./environment.js";

// UNIT_BOUNDARY_DESCRIPTION: the path every Environment address reserves for the platform's own sign-in and sign-out; the relay never forwards it to the app.
export const RESERVED_PREFIX = "/.platform/";

// UNIT_BOUNDARY_DESCRIPTION: a visitor's session on one Environment address, in a `__Host-` cookie (https) that the browser sends to that exact origin only, so no other Environment or platform host can set or read it. Over plain http (the local cluster) the prefix cannot be used, and the cookie is host-only anyway.
export const SESSION_COOKIE_SECURE = "__Host-platform-env";
export const SESSION_COOKIE_PLAIN = "platform-env";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LOGIN_TTL_MS = 5 * 60 * 1000;

export interface EnvironmentSession {
  sub: string;
  email: string | null;
  address: string;
  createdAt: number;
}

export interface PendingEnvironmentLogin {
  codeVerifier: string;
  nonce: string;
  address: string;
  next: string;
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
 * UNIT_BOUNDARY_DESCRIPTION: Who may open an Environment. In this slice only
 * its owner, by their platform sign-in; a session made for another address
 * counts as no session, so a cookie carried to another Environment opens
 * nothing.
 */
export function decideAccess(
  record: Pick<EnvironmentRecord, "owner">,
  session: EnvironmentSession | null,
  address: string,
): AccessDecision {
  if (!session || session.address !== address)
    return { allow: false, reason: "not-signed-in" };
  if (session.sub === record.owner) return { allow: true };
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
