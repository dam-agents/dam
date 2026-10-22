import crypto from "node:crypto";
import net from "node:net";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { proxy } from "hono/proxy";
import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";
import {
  appSetCookie,
  cookieValue,
  decideAccess,
  effectiveAccess,
  environmentOrigins,
  isSignInToken,
  parseAddress,
  relayHeaders,
  requestAllowed,
  RESERVED_PREFIX,
  siblingPreflight,
  SESSION_COOKIE_PLAIN,
  SESSION_COOKIE_SECURE,
  SESSION_TTL_MS,
  signInBinding,
  SIGNIN_COOKIE_PLAIN,
  SIGNIN_COOKIE_SECURE,
  SIGNIN_TTL_MS,
  type EnvironmentSession,
  type PlatformCredentials,
} from "../domain/gate.js";
import type { EnvironmentRecord } from "../domain/environment.js";
import type { EnvironmentsRepository } from "../infrastructure/environments-repository.js";
import type { EnvironmentSignIn } from "../services/environment-signin.js";
import { renderGatePage } from "./pages.js";

const FORWARD_PREFIX = "/api/environment/forward/";
const DECLARED_PORTS_HEADER = "x-platform-environment-ports";
const ACTIVITY_INTERVAL_MS = 60_000;
const NO_STORE = "private, no-store";
const HOP_BY_HOP = [
  "transfer-encoding",
  "keep-alive",
  "expect",
  "upgrade",
  "te",
  "trailer",
];

// UNIT_BOUNDARY_DESCRIPTION: the headers every page and redirect the gate answers with itself carry, as the platform's own pages do; the gate answers before the platform's security-headers middleware runs. A relayed response is the app's, and keeps its own.
const GATE_HEADERS: Record<string, string> = {
  "Cache-Control": NO_STORE,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

export interface EnvironmentGateDeps {
  domain: string;
  scheme: "http" | "https";
  // UNIT_BOUNDARY_DESCRIPTION: the share host's front door for an address, where a visitor without a session is sent to sign in, with the path to return to on the address, the binding of the browser's sign-in secret, and the sign-in chain it is a step of, if any; and the share host's sign-out, which ends the identity provider's session too and offers to sign in again.
  frontDoorUrl: (
    address: string,
    next: string,
    binding: string,
    chain?: string,
  ) => string;
  signOutUrl: (address: string) => string;
  repo: Pick<EnvironmentsRepository, "getByHost">;
  ownerList: (owningAgentId: string) => Promise<string[]>;
  signIn: Pick<EnvironmentSignIn, "redeemHandoff" | "session" | "signOut">;
  platform: PlatformCredentials;
  ensureReady: (agentId: string) => Promise<unknown>;
  stampActivity: (agentId: string) => Promise<void>;
  upstream: (agentId: string) => { host: string; port: number };
  brandName: string;
}

export interface EnvironmentGate {
  middleware: MiddlewareHandler;
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
}

interface Resolved {
  record: EnvironmentRecord;
  port: number;
  address: string;
}

export const noEnvironmentGate: EnvironmentGate = {
  middleware: (_c, next) => next(),
  handleUpgrade: () => false,
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: The api-server's front for every Environment
 * address, `<endpoint>-<host>.<environments domain>`, which one wildcard
 * Ingress sends here. It finds the Environment and endpoint from the host
 * name, admits the visitor by the session the share host's front door handed
 * it (the owner, or a verified email on the effective list, checked again on
 * every request, while the share host's session it came from lasts), wakes a
 * sleeping Environment and waits for it, and relays HTTP and WebSocket to the
 * Environment runtime's forward, which reaches only the declared port on the
 * Environment's loopback. Any other host passes on untouched. A request
 * that another origin's page makes in the visitor's name is refused before
 * any of that, whatever cookie it carries. The relay never passes the platform's own
 * cookies or `Authorization` header to the app, never lets the app set them,
 * marks every response uncacheable, and refreshes the Environment's activity
 * at most once a minute; no connection pins it awake.
 */
export function createEnvironmentGate(
  deps: EnvironmentGateDeps,
): EnvironmentGate {
  const secure = deps.scheme === "https";
  const cookieName = secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_PLAIN;
  const signInCookieName = secure ? SIGNIN_COOKIE_SECURE : SIGNIN_COOKIE_PLAIN;
  const lastStamp = new Map<string, number>();

  function stamp(agentId: string) {
    const now = Date.now();
    if (now - (lastStamp.get(agentId) ?? 0) < ACTIVITY_INTERVAL_MS) return;
    lastStamp.set(agentId, now);
    if (lastStamp.size > 10_000) lastStamp.clear();
    void deps.stampActivity(agentId).catch(() => {});
  }

  async function resolve(
    hostHeader: string | undefined,
  ): Promise<Resolved | "none" | null> {
    const parsed = parseAddress(hostHeader, deps.domain);
    if (!parsed) return null;
    const record = await deps.repo.getByHost(parsed.host);
    const endpoint = record?.endpoints.find((e) => e.name === parsed.endpoint);
    if (!record || !endpoint) return "none";
    return { record, port: endpoint.port, address: parsed.address };
  }

  function gateHeaders(c: Context) {
    for (const [name, value] of Object.entries(GATE_HEADERS))
      c.header(name, value);
  }

  function page(
    c: Context,
    status: 401 | 403 | 404 | 400 | 502,
    title: string,
    body: string,
  ) {
    gateHeaders(c);
    return c.html(
      renderGatePage({ brandName: deps.brandName, title, body }),
      status,
    );
  }

  function isNavigation(c: Context) {
    return (
      (c.req.method === "GET" || c.req.method === "HEAD") &&
      (c.req.header("sec-fetch-mode") === "navigate" ||
        (c.req.header("accept") ?? "").includes("text/html"))
    );
  }

  // UNIT_BOUNDARY_DESCRIPTION: the browser's sign-in secret for this address: the one it holds, or a new one; either way set again for the next ten minutes, so a sign-in in another tab of the same browser keeps working.
  function signInSecret(c: Context): string {
    const held = getCookie(c, signInCookieName);
    const secret = isSignInToken(held)
      ? held
      : crypto.randomBytes(32).toString("base64url");
    setCookie(c, signInCookieName, secret, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(SIGNIN_TTL_MS / 1000),
    });
    return secret;
  }

  function ownOrigins(record: EnvironmentRecord, host: string | undefined) {
    return environmentOrigins(record, {
      scheme: deps.scheme,
      domain: deps.domain,
      hostHeader: host,
    });
  }

  function allowed(
    record: EnvironmentRecord,
    host: string | undefined,
    source: { origin: string | undefined; site: string | undefined },
  ) {
    return requestAllowed(source, ownOrigins(record, host));
  }

  // UNIT_BOUNDARY_DESCRIPTION: lets a page of another endpoint of the same Environment read the gate's own refusal, so it sees a 401 or 403 instead of a network error; the gate's pages carry nothing that endpoint may not see.
  function siblingCors(c: Context, record: EnvironmentRecord) {
    const origin = c.req.header("origin");
    if (
      origin === undefined ||
      !ownOrigins(record, c.req.header("host")).has(origin)
    )
      return;
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
  }

  async function reserved(
    c: Context,
    address: string,
    record: EnvironmentRecord,
  ): Promise<Response> {
    const path = c.req.path;
    if (path === "/.platform/session") {
      const redeemed = await deps.signIn.redeemHandoff(
        c.req.query("code") ?? "",
        address,
        getCookie(c, signInCookieName) ?? "",
      );
      if (!redeemed)
        return page(
          c,
          400,
          "Sign-in expired",
          "This sign-in link was used, has expired, or was opened in another browser. Open the Environment's link again.",
        );
      setCookie(c, cookieName, redeemed.sessionId, {
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: "/",
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      });
      securityLog("info", "environment.session", {
        category: "authn",
        actor: redeemed.session.sub,
        actorKind: "user",
        agentId: record.agentId,
        result: "success",
        detail: { address, email: redeemed.session.email },
      });
      gateHeaders(c);
      return c.redirect(redeemed.next, 302);
    }
    if (path === "/.platform/signin") {
      const chain = c.req.query("chain") ?? "";
      if (!isSignInToken(chain))
        return page(c, 404, "Not found", "Nothing is served here.");
      gateHeaders(c);
      return c.html(
        renderGatePage({
          brandName: deps.brandName,
          title: "Signing you in",
          body: "Signing you in to every part of this Environment.",
          continueTo: deps.frontDoorUrl(
            address,
            "/",
            signInBinding(signInSecret(c)),
            chain,
          ),
        }),
        200,
      );
    }
    if (path === "/.platform/sign-out") {
      const id = getCookie(c, cookieName);
      if (id) await deps.signIn.signOut(id);
      deleteCookie(c, cookieName, { path: "/", secure });
      gateHeaders(c);
      return c.redirect(deps.signOutUrl(address), 302);
    }
    return page(c, 404, "Not found", "Nothing is served here.");
  }

  async function session(
    sessionId: string | undefined,
  ): Promise<EnvironmentSession | null> {
    return sessionId ? deps.signIn.session(sessionId) : null;
  }

  function deny(
    record: EnvironmentRecord,
    session: EnvironmentSession | null,
    address: string,
    reason: string,
  ) {
    securityLog("warn", "environment.access_deny", {
      category: "authz",
      actor: session?.sub ?? null,
      actorKind: "user",
      agentId: record.agentId,
      decision: "deny",
      reason,
      detail: { address },
    });
  }

  function upstreamPath(resolved: Resolved, pathAndQuery: string) {
    return `${FORWARD_PREFIX}${resolved.port}${pathAndQuery}`;
  }

  function declaredPorts(record: EnvironmentRecord) {
    return record.endpoints.map((e) => e.port).join(",");
  }

  async function relay(c: Context, resolved: Resolved): Promise<Response> {
    const url = new URL(c.req.url);
    const headers = relayHeaders(c.req.raw.headers, {
      address: resolved.address,
      publicHost: c.req.header("host") ?? "",
      scheme: deps.scheme,
      platform: deps.platform,
    });
    headers.set(DECLARED_PORTS_HEADER, declaredPorts(resolved.record));
    // UNIT_BOUNDARY_DESCRIPTION: the visitor's hop-by-hop headers describe its own connection, and fetch refuses a request that carries them (a chunked upload, an `Expect: 100-continue`); the body still streams, which proxy() sends chunked itself.
    for (const name of HOP_BY_HOP) headers.delete(name);
    const target = deps.upstream(resolved.record.agentId);
    let answer: Response;
    try {
      answer = await proxy(
        `http://${target.host}:${target.port}${upstreamPath(resolved, `${url.pathname}${url.search}`)}`,
        { raw: c.req.raw, headers, redirect: "manual" },
      );
    } catch (e) {
      getLogger().warn(
        { agentId: resolved.record.agentId, error: (e as Error).message },
        "environment-gate.upstream.failed",
      );
      return page(
        c,
        502,
        "Not answering",
        "The Environment did not answer. Try again in a moment.",
      );
    }
    const out = new Headers();
    for (const [name, value] of answer.headers) {
      if (name === "cache-control" || name === "set-cookie") continue;
      out.append(name, value);
    }
    for (const cookie of answer.headers.getSetCookie()) {
      const kept = appSetCookie(cookie);
      if (kept !== null) out.append("set-cookie", kept);
    }
    out.set("Cache-Control", NO_STORE);
    return new Response(answer.body, { status: answer.status, headers: out });
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    const resolved = await resolve(c.req.header("host"));
    if (resolved === null) return next();
    if (resolved === "none")
      return page(
        c,
        404,
        "No such Environment",
        "This address names no Environment, or one that was deleted.",
      );
    const { record, address } = resolved;
    if (
      !allowed(record, c.req.header("host"), {
        origin: c.req.header("origin"),
        site: c.req.header("sec-fetch-site"),
      })
    ) {
      deny(record, null, address, "cross-origin");
      return page(
        c,
        403,
        "Refused",
        "A page of another site asked for this in your name, so the Environment did not answer it.",
      );
    }
    if (c.req.path.startsWith(RESERVED_PREFIX))
      return reserved(c, address, record);
    const preflight = siblingPreflight(
      {
        method: c.req.method,
        origin: c.req.header("origin"),
        requestMethod: c.req.header("access-control-request-method"),
        requestHeaders: c.req.header("access-control-request-headers"),
      },
      ownOrigins(record, c.req.header("host")),
    );
    if (preflight) {
      gateHeaders(c);
      for (const [name, value] of Object.entries(preflight))
        c.header(name, value);
      return c.body(null, 204);
    }

    const visitor = await session(getCookie(c, cookieName));
    const access = decideAccess(
      record,
      effectiveAccess(
        await deps.ownerList(record.owningAgentId),
        record.access,
      ),
      visitor,
      address,
    );
    if (!access.allow) {
      deny(record, visitor, address, access.reason);
      siblingCors(c, record);
      if (access.reason === "not-signed-in") {
        if (isNavigation(c)) {
          gateHeaders(c);
          const url = new URL(c.req.url);
          return c.redirect(
            deps.frontDoorUrl(
              address,
              `${url.pathname}${url.search}`,
              signInBinding(signInSecret(c)),
            ),
            302,
          );
        }
        return page(c, 401, "Sign in", "Sign in to open this Environment.");
      }
      return page(
        c,
        403,
        "You don't have access",
        visitor?.email
          ? `You are signed in as ${visitor.email}, which is no longer on this Environment's list. Ask the person who sent you the link to add you again.`
          : "Your account has no verified email address, so it cannot be on this Environment's list. Ask the person who sent you the link.",
      );
    }

    try {
      await deps.ensureReady(record.agentId);
    } catch (e) {
      getLogger().warn(
        { agentId: record.agentId, error: (e as Error).message },
        "environment-gate.wake.failed",
      );
      return page(
        c,
        502,
        "Not running",
        "The Environment could not be woken. Try again in a moment.",
      );
    }
    stamp(record.agentId);
    return relay(c, resolved);
  };

  function refuseUpgrade(socket: Duplex, status: string) {
    socket.end(
      `HTTP/1.1 ${status}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n`,
    );
  }

  // UNIT_BOUNDARY_DESCRIPTION: passes the app's answer to a WebSocket upgrade on to the visitor without its Set-Cookie lines, which no rule would filter there, then hands the socket over. An app sets cookies over HTTP, where the relay filters them. An app that closes before it answered closes the visitor's socket too.
  function relayHandshake(upstream: Duplex, socket: Duplex, then: () => void) {
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buffered.length > 64 * 1024) socket.destroy();
        return;
      }
      upstream.off("data", onData);
      upstream.pause();
      const head = buffered
        .subarray(0, end)
        .toString("latin1")
        .split("\r\n")
        .filter((line) => !/^set-cookie\s*:/i.test(line))
        .join("\r\n");
      socket.write(`${head}\r\n\r\n`);
      const rest = buffered.subarray(end + 4);
      if (rest.length > 0) socket.write(rest);
      then();
    };
    upstream.on("data", onData);
    upstream.once("end", () => {
      if (buffered.indexOf("\r\n\r\n") === -1) socket.destroy();
    });
  }

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    if (parseAddress(req.headers.host, deps.domain) === null) return false;
    socket.on("error", () => socket.destroy());
    void (async () => {
      const resolved = await resolve(req.headers.host);
      if (resolved === null || resolved === "none")
        return refuseUpgrade(socket, "404 Not Found");
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname.startsWith(RESERVED_PREFIX))
        return refuseUpgrade(socket, "404 Not Found");
      const site = req.headers["sec-fetch-site"];
      if (
        !allowed(resolved.record, req.headers.host, {
          origin: req.headers.origin,
          site: Array.isArray(site) ? site[0] : site,
        })
      ) {
        deny(resolved.record, null, resolved.address, "cross-origin");
        return refuseUpgrade(socket, "403 Forbidden");
      }
      const cookie = cookieValue(req.headers.cookie, cookieName);
      const visitor = await session(cookie);
      const access = decideAccess(
        resolved.record,
        effectiveAccess(
          await deps.ownerList(resolved.record.owningAgentId),
          resolved.record.access,
        ),
        visitor,
        resolved.address,
      );
      if (!access.allow) {
        deny(resolved.record, visitor, resolved.address, access.reason);
        return refuseUpgrade(
          socket,
          access.reason === "not-signed-in"
            ? "401 Unauthorized"
            : "403 Forbidden",
        );
      }
      try {
        await deps.ensureReady(resolved.record.agentId);
      } catch {
        return refuseUpgrade(socket, "502 Bad Gateway");
      }
      stamp(resolved.record.agentId);

      const incoming = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        incoming.append(
          req.rawHeaders[i]!.toLowerCase(),
          req.rawHeaders[i + 1]!,
        );
      const headers = relayHeaders(incoming, {
        address: resolved.address,
        publicHost: req.headers.host ?? "",
        scheme: deps.scheme,
        platform: deps.platform,
      });
      headers.set(DECLARED_PORTS_HEADER, declaredPorts(resolved.record));
      headers.set("connection", "Upgrade");
      const target = deps.upstream(resolved.record.agentId);
      const upstream = net.connect(target.port, target.host, () => {
        const lines = [
          `${req.method} ${upstreamPath(resolved, `${url.pathname}${url.search}`)} HTTP/1.1`,
          `host: ${target.host}:${target.port}`,
        ];
        for (const [name, value] of headers) lines.push(`${name}: ${value}`);
        upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        relayHandshake(upstream, socket, () => {
          upstream.pipe(socket);
          socket.pipe(upstream);
        });
      });
      socket.on("data", () => stamp(resolved.record.agentId));
      const close = () => {
        upstream.destroy();
        socket.destroy();
      };
      upstream.on("error", () => {
        if (socket.writable) refuseUpgrade(socket, "502 Bad Gateway");
        close();
      });
      socket.on("close", () => upstream.destroy());
    })().catch((e: unknown) => {
      getLogger().warn(
        { error: (e as Error).message },
        "environment-gate.upgrade.failed",
      );
      socket.destroy();
    });
    return true;
  }

  return { middleware, handleUpgrade };
}
