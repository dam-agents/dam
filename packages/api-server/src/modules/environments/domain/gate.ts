import crypto from "node:crypto";
import type { EnvironmentRecord } from "./environment.js";

// UNIT_BOUNDARY_DESCRIPTION: the path every Environment address reserves for the hand-off of its session, the steps of a sign-in and its sign-out; the relay never forwards it to the app.
export const RESERVED_PREFIX = "/.platform/";

// UNIT_BOUNDARY_DESCRIPTION: a visitor's session on one Environment address, in a `__Host-` cookie (https) that the browser sends to that exact origin only, so no other Environment or platform host can set or read it. Over plain http (the local cluster) the prefix cannot be used, and the cookie is host-only anyway.
export const SESSION_COOKIE_SECURE = "__Host-platform-env";
export const SESSION_COOKIE_PLAIN = "platform-env";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// UNIT_BOUNDARY_DESCRIPTION: the secret of a sign-in the address started, in a cookie of the same kind, which only the browser that started it holds; the front door binds its hand-off code to the secret's hash, so the code opens nothing in another browser.
export const SIGNIN_COOKIE_SECURE = "__Host-platform-env-signin";
export const SIGNIN_COOKIE_PLAIN = "platform-env-signin";
export const SIGNIN_TTL_MS = 10 * 60 * 1000;

export interface EnvironmentSession {
  sub: string;
  email: string | null;
  address: string;
  // UNIT_BOUNDARY_DESCRIPTION: the share host's session the visitor was handed from; the address's session lasts only while it does.
  shareSession: string;
  createdAt: number;
}

const PLATFORM_COOKIES = new Set([
  SESSION_COOKIE_SECURE,
  SESSION_COOKIE_PLAIN,
  SIGNIN_COOKIE_SECURE,
  SIGNIN_COOKIE_PLAIN,
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a cookie, as one `name=value` pair of a
 * `Cookie` header or the start of a `Set-Cookie` header, is one of the
 * platform's own cookies on an address: its session or its sign-in secret.
 * The name is compared once trimmed, as a browser stores it, so a padded name
 * (`platform-env =x`) is the platform's cookie too.
 */
export function isPlatformCookie(cookie: string): boolean {
  return PLATFORM_COOKIES.has(cookie.split("=", 1)[0]!.trim());
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The value a hand-off code is bound to: the
 * SHA-256 of the sign-in secret, base64url. The front door sees only this,
 * and the address checks the secret against it when the code comes back.
 */
export function signInBinding(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("base64url");
}

// UNIT_BOUNDARY_DESCRIPTION: whether a value has the shape of a sign-in secret or of its binding: 32 bytes, base64url.
export function isSignInToken(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An app's `Set-Cookie` as the visitor gets it, or
 * null when it may not pass: the platform's own cookies never do, and
 * any other loses its `Domain` attribute, so the cookie stays on the address
 * that set it. Every address shares the environments domain, and a cookie
 * set for that domain would reach every other Environment's app.
 */
export function appSetCookie(cookie: string): string | null {
  if (isPlatformCookie(cookie)) return null;
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
 * UNIT_BOUNDARY_DESCRIPTION: The people who may open one Environment: its
 * owning agent's Agent Environment Members, the Environment's own Environment
 * Members, and the owning agent's Agent Editors. Each list only adds people,
 * so no list narrows another, and the agent sets none of them. Emails compare
 * trimmed and lowercased.
 */
export function effectiveAccess(
  agentMembers: readonly string[],
  environmentMembers: readonly string[],
  editors: readonly string[],
): string[] {
  const normalize = (e: string) => e.trim().toLowerCase();
  return [
    ...new Set(
      [...agentMembers, ...environmentMembers, ...editors].map(normalize),
    ),
  ];
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

const SAME_ORIGIN_BASE = "https://address.invalid";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A sign-in's return path on the address it began
 * on: a path of that origin, never another host. A browser drops a tab or a
 * newline from a URL and reads a backslash as a slash, so `/<tab>/evil` would
 * go to another host; every control character and backslash is refused, and
 * the path must still name the same origin once a URL parser has read it.
 */
export function safeNext(path: string | undefined): string {
  if (
    path === undefined ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith(RESERVED_PREFIX) ||
    /[\u0000-\u001f\u007f\\]/.test(path) ||
    new URL(path, SAME_ORIGIN_BASE).origin !== SAME_ORIGIN_BASE
  )
    return "/";
  return path;
}

// UNIT_BOUNDARY_DESCRIPTION: the platform's own credentials, which never reach an Environment's app: the issuers its identity provider's tokens may name, and what makes a token a platform API key.
export interface PlatformCredentials {
  issuers: readonly string[];
  isApiKey: (token: string) => boolean;
}

// UNIT_BOUNDARY_DESCRIPTION: the request headers the relay never passes on: the headers that only describe this hop, and the one that names the declared ports. `Authorization` is judged by its value, in platformCredential.
const DROPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "proxy-authorization",
  "x-platform-environment-ports",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether an `Authorization` value is one of the
 * platform's own credentials: a platform API key, or a bearer token whose
 * issuer is one of the platform's identity provider's addresses, or that
 * names none. The value of a token's `iss` claim is read, not checked: an
 * app's token from any other issuer reaches the app, and a value that may be
 * the platform's is dropped whatever its signature, and so is a bearer value
 * that is not one token, such as two `Authorization` headers a client joined.
 * Any other scheme passes.
 */
export function platformCredential(
  value: string,
  platform: PlatformCredentials,
): boolean {
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(value);
  if (!match) return /^\s*bearer\b/i.test(value);
  const token = match[1]!;
  if (platform.isApiKey(token)) return true;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    );
    const iss =
      claims !== null && typeof claims === "object" && "iss" in claims
        ? claims.iss
        : undefined;
    return typeof iss !== "string" || platform.issuers.includes(iss);
  } catch {
    return true;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The headers an Environment's app gets. The
 * platform's session cookies are dropped and every other cookie passes, so the
 * app sees only cookies it set itself on its own address. An `Authorization`
 * header passes only when it is not one of the platform's own credentials, so
 * an app that signs its users in itself gets their tokens, and a platform
 * token never reaches a build. The original host and scheme go on as the usual
 * forwarded headers, for an app that builds its own URLs.
 */
export function relayHeaders(
  incoming: Headers,
  opts: {
    address: string;
    publicHost: string;
    scheme: string;
    platform: PlatformCredentials;
  },
): Headers {
  const out = new Headers();
  for (const [name, value] of incoming) {
    if (DROPPED_REQUEST_HEADERS.has(name)) continue;
    if (name === "authorization") {
      if (!platformCredential(value, opts.platform)) out.set(name, value);
      continue;
    }
    if (name === "cookie") {
      const kept = value
        .split(";")
        .map((c) => c.trim())
        .filter((c) => c !== "" && !isPlatformCookie(c));
      if (kept.length > 0) out.set("cookie", kept.join("; "));
      continue;
    }
    out.append(name, value);
  }
  out.set("x-forwarded-host", opts.publicHost);
  out.set("x-forwarded-proto", opts.scheme);
  return out;
}

// UNIT_BOUNDARY_DESCRIPTION: the address of each of an Environment's endpoints, `<endpoint>-<host>`, the first DNS label under the environments domain.
export function endpointAddresses(
  record: Pick<EnvironmentRecord, "host" | "endpoints">,
): string[] {
  return record.endpoints.map((e) => `${e.name}-${record.host}`);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The origins of one Environment's endpoints, as a
 * browser names them: every one of its addresses, with the scheme and the
 * port the visitor used. The endpoints of one Environment may call each
 * other; any other origin is another site to them.
 */
export function environmentOrigins(
  record: Pick<EnvironmentRecord, "host" | "endpoints">,
  opts: { scheme: string; domain: string; hostHeader: string | undefined },
): Set<string> {
  const port = /:\d+$/.exec(opts.hostHeader ?? "")?.[0] ?? "";
  return new Set(
    endpointAddresses(record).map(
      (address) => `${opts.scheme}://${address}.${opts.domain}${port}`,
    ),
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether an address serves a request, by the
 * origin the browser says asked for it. Every page under the platform's
 * parent domain is the same site as the address, so the browser sends the
 * visitor's session cookie with a request any of them makes; the cookie alone
 * never says the visitor's own page asked. A browser names the asking page's
 * origin with every request that can act or read the answer — a script's
 * call, a form post, a WebSocket — and with none of a link, a typed address,
 * a frame or an image. Served: a request with no origin, or from an endpoint
 * of the address's own Environment. A page whose `Referrer-Policy` is
 * `no-referrer` sends its form posts with the opaque origin `null`; such a
 * request is served only when the browser also marks it `Sec-Fetch-Site:
 * same-origin`, which no page can set. Refused: any other origin, and `null`
 * from anywhere else.
 */
export function requestAllowed(
  source: { origin: string | undefined; site: string | undefined },
  own: ReadonlySet<string>,
): boolean {
  if (source.origin === undefined || own.has(source.origin)) return true;
  return source.origin === "null" && source.site === "same-origin";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The gate's own answer to a browser's CORS
 * preflight from another endpoint of the same Environment, or null for any
 * other request. A browser sends a preflight without cookies before a
 * cross-origin call that needs one, so no session can admit it, and any client
 * can claim an origin, so the app never gets it: the gate allows the method
 * and headers asked for, with credentials. The call that follows carries the
 * session and is checked as any other, and its answer is the app's, which
 * decides whether the page may read it.
 */
export function siblingPreflight(
  request: {
    method: string;
    origin: string | undefined;
    requestMethod: string | undefined;
    requestHeaders: string | undefined;
  },
  own: ReadonlySet<string>,
): Record<string, string> | null {
  if (
    request.method !== "OPTIONS" ||
    request.requestMethod === undefined ||
    request.origin === undefined ||
    !own.has(request.origin)
  )
    return null;
  return {
    "Access-Control-Allow-Origin": request.origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": request.requestMethod,
    ...(request.requestHeaders && {
      "Access-Control-Allow-Headers": request.requestHeaders,
    }),
    "Access-Control-Max-Age": "600",
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  };
}
