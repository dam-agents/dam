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
  decideAgentAccess,
  effectiveAccess,
  endpointAddresses,
  environmentOrigins,
  isSignInToken,
  parseAddress,
  relayHeaders,
  requestAllowed,
  RESERVED_PREFIX,
  safeNext,
  siblingPreflight,
  SESSION_COOKIE_PLAIN,
  SESSION_COOKIE_SECURE,
  SESSION_TTL_MS,
  signInBinding,
  SIGNIN_COOKIE_PLAIN,
  SIGNIN_COOKIE_SECURE,
  SIGNIN_TTL_MS,
  type AgentVisitor,
  type EnvironmentSession,
  type PlatformCredentials,
} from "../domain/gate.js";
import { AGENT_KEY_HEADER, isAgentKey } from "../../agent-keys/index.js";
import type { EnvironmentRecord } from "../domain/environment.js";
import type { EnvironmentsRepository } from "../infrastructure/environments-repository.js";
import type { EnvironmentSignIn } from "../services/environment-signin.js";
import { createEndpointReadiness } from "./endpoint-readiness.js";
import { renderGatePage } from "./pages.js";

const FORWARD_PREFIX = "/api/environment/forward/";
const DECLARED_PORTS_HEADER = "x-platform-environment-ports";
const UNREACHABLE_HEADER = "x-platform-environment-unreachable";
const STATUS_PATH = `${RESERVED_PREFIX}status`;
const START_PATH = `${RESERVED_PREFIX}start`;
const ACTIVITY_INTERVAL_MS = 60_000;
const WAKE_FAILED_HOLD_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;
const RETRY_AFTER_S = 5;
const SLOW_AFTER_MS = 5 * 60_000;
const NO_STORE = "private, no-store";
const PROXY_WAITING_STATUSES = new Set([502, 503, 504]);
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
  agentMembers: (owningAgentId: string) => Promise<string[]>;
  environmentMembers: (environmentId: string) => Promise<string[]>;
  editorsOf: (owningAgentId: string) => Promise<string[]>;
  // UNIT_BOUNDARY_DESCRIPTION: the Agents that may open an Environment: those its own list and its Owning Agent's list name.
  memberAgents: (record: EnvironmentRecord) => Promise<string[]>;
  // UNIT_BOUNDARY_DESCRIPTION: the Agent an Agent Key names, or null.
  agentOfKey: (key: string) => Promise<AgentVisitor | null>;
  // UNIT_BOUNDARY_DESCRIPTION: records that an Agent opened an Environment; the gate calls it at most once a minute per pair.
  recordAgentVisit: (environmentId: string, agentId: string) => Promise<void>;
  signIn: Pick<
    EnvironmentSignIn,
    "redeemHandoff" | "completeSignIn" | "session" | "signOut"
  >;
  platform: PlatformCredentials;
  ensureReady: (
    agentId: string,
    opts: { onWaking: () => void },
  ) => Promise<unknown>;
  stampActivity: (agentId: string) => Promise<void>;
  upstream: (agentId: string) => { host: string; port: number };
  brandName: string;
  readinessRetryMs?: number;
}

export interface EnvironmentGate {
  middleware: MiddlewareHandler;
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
}

interface Resolved {
  record: EnvironmentRecord;
  port: number;
  ready: string | undefined;
  address: string;
}

type MachineState = "ready" | "waking" | "failed";

// UNIT_BOUNDARY_DESCRIPTION: one endpoint of an Environment as its readiness probe reaches it: through the runtime's forward to its port, with the public host a router inside the Environment tells endpoints apart by.
interface ProbeTarget {
  agentId: string;
  endpoint: string;
  port: number;
  ready: string | undefined;
  ports: string;
  publicHost: string;
}

function isProxyWaiting(status: number): boolean {
  return PROXY_WAITING_STATUSES.has(status);
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
 * every request, while the share host's session it came from lasts), or the
 * Agent whose key its gateway sent (the Owning Agent, or an Agent a list
 * names; that request's cookie counts for nothing), wakes a
 * sleeping Environment without waiting for it, and relays HTTP and WebSocket
 * to the Environment runtime's forward, which reaches only the declared port
 * on the Environment's loopback. While the machine wakes, a page load gets a
 * loading page that opens the app by itself, and any other request a 503 to
 * try again. Once it runs, every request but a page load goes to the app
 * as it is; a page load waits on the loading page only while nothing behind
 * the endpoint answers it, or while a declared readiness path does not. Any other host passes on untouched. A request
 * that another origin's page makes in the visitor's name is refused before
 * any of that, whatever cookie it carries. The relay never passes the
 * platform's own cookies or credentials to the app, never lets the app set
 * those cookies, marks every response uncacheable, and refreshes the Environment's activity
 * at most once a minute; no connection pins it awake.
 */
export function createEnvironmentGate(
  deps: EnvironmentGateDeps,
): EnvironmentGate {
  const secure = deps.scheme === "https";
  const cookieName = secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_PLAIN;
  const signInCookieName = secure ? SIGNIN_COOKIE_SECURE : SIGNIN_COOKIE_PLAIN;
  const lastStamp = new Map<string, number>();
  const waking = new Set<string>();
  const wakeFailedAt = new Map<string, number>();
  const readiness = createEndpointReadiness<ProbeTarget>({
    probe,
    ...(deps.readinessRetryMs !== undefined
      ? { retryMs: deps.readinessRetryMs }
      : {}),
  });

  function stamp(agentId: string) {
    const now = Date.now();
    if (now - (lastStamp.get(agentId) ?? 0) < ACTIVITY_INTERVAL_MS) return;
    lastStamp.set(agentId, now);
    if (lastStamp.size > 10_000) lastStamp.clear();
    void deps.stampActivity(agentId).catch(() => {});
  }

  const lastAgentVisit = new Map<string, number>();

  // UNIT_BOUNDARY_DESCRIPTION: an admitted Agent's request, recorded at most once a minute per Agent and Environment: a test suite sends thousands, and the owner needs to know that the Agent opens it and when it last did, not each request.
  function agentVisited(
    record: EnvironmentRecord,
    agent: AgentVisitor,
    address: string,
  ) {
    const key = `${record.agentId}\n${agent.agentId}`;
    const now = Date.now();
    if (now - (lastAgentVisit.get(key) ?? 0) < ACTIVITY_INTERVAL_MS) return;
    lastAgentVisit.set(key, now);
    if (lastAgentVisit.size > 10_000) lastAgentVisit.clear();
    securityLog("info", "environment.agent_access", {
      category: "authz",
      actor: agent.agentId,
      actorKind: "agent",
      agentId: record.agentId,
      decision: "allow",
      detail: { address },
    });
    void deps.recordAgentVisit(record.agentId, agent.agentId).catch(() => {});
  }

  // UNIT_BOUNDARY_DESCRIPTION: whether a request came from an Agent's gateway, by the header only a gateway sets; such a request is the Agent's, whatever cookie it carries, so a person's sign-in in the Agent's browser never opens more than the Agent's own lists do.
  function agentKeyOf(
    value: string | string[] | undefined,
  ): string | null | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined) return undefined;
    return isAgentKey(raw) ? raw : null;
  }

  async function agentAccess(record: EnvironmentRecord, key: string | null) {
    const visitor = key === null ? null : await deps.agentOfKey(key);
    return {
      visitor,
      access: decideAgentAccess(
        record,
        await deps.memberAgents(record),
        visitor,
      ),
    };
  }

  function denyAgent(
    record: EnvironmentRecord,
    visitor: AgentVisitor | null,
    address: string,
  ) {
    securityLog("warn", "environment.access_deny", {
      category: "authz",
      actor: visitor?.agentId ?? null,
      actorKind: "agent",
      agentId: record.agentId,
      decision: "deny",
      reason: visitor ? "not-allowed" : "unknown-agent-key",
      detail: { address },
    });
  }

  async function resolve(
    hostHeader: string | undefined,
  ): Promise<Resolved | "none" | null> {
    const parsed = parseAddress(hostHeader, deps.domain);
    if (!parsed) return null;
    const record = await deps.repo.getByHost(parsed.host);
    const endpoint = record?.endpoints.find((e) => e.name === parsed.endpoint);
    if (!record || !endpoint) return "none";
    return {
      record,
      port: endpoint.port,
      ready: endpoint.ready,
      address: parsed.address,
    };
  }

  // UNIT_BOUNDARY_DESCRIPTION: whether an endpoint's app answers: its readiness path with 2xx or 3xx, or, without one, anything on its port but a proxy's "nothing behind me yet" (502, 503, 504), which a bridge or an ingress in front of a starting app answers at once. The runtime marks its own answer when nothing listens there; an app's own 500 counts as an answer.
  async function probe(target: ProbeTarget): Promise<boolean> {
    const runtime = deps.upstream(target.agentId);
    const answer = await fetch(
      `http://${runtime.host}:${runtime.port}${FORWARD_PREFIX}${target.port}${target.ready ?? "/"}`,
      {
        method: target.ready === undefined ? "HEAD" : "GET",
        headers: {
          [DECLARED_PORTS_HEADER]: target.ports,
          "x-forwarded-host": target.publicHost,
          "x-forwarded-proto": deps.scheme,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
    void answer.body?.cancel().catch(() => {});
    if (answer.headers.has(UNREACHABLE_HEADER)) return false;
    if (target.ready === undefined) return !isProxyWaiting(answer.status);
    return answer.status >= 200 && answer.status < 400;
  }

  function probeTarget(
    resolved: Resolved,
    publicHost: string | undefined,
  ): ProbeTarget {
    const endpoint = resolved.address.slice(0, resolved.address.indexOf("-"));
    return {
      agentId: resolved.record.agentId,
      endpoint,
      port: resolved.port,
      ready: resolved.ready,
      ports: declaredPorts(resolved.record),
      publicHost: publicHost ?? "",
    };
  }

  // UNIT_BOUNDARY_DESCRIPTION: wakes the Environment and says at once whether its machine runs, is still waking, or could not be woken; a request never waits for a wake. A wake that failed is not tried again for half a minute, so a waiting page can say it did not start, unless the visitor asks to try again. A finished wake forgets what was known of its endpoints, since their apps start again.
  function machine(agentId: string): Promise<MachineState> {
    const failed = wakeFailedAt.get(agentId);
    if (failed !== undefined && Date.now() - failed < WAKE_FAILED_HOLD_MS)
      return Promise.resolve("failed");
    if (waking.has(agentId)) return Promise.resolve("waking");
    return new Promise((resolve) => {
      let slept = false;
      deps
        .ensureReady(agentId, {
          onWaking: () => {
            slept = true;
            waking.add(agentId);
            resolve("waking");
          },
        })
        .then(
          () => {
            wakeFailedAt.delete(agentId);
            if (slept) readiness.forget(agentId);
            resolve("ready");
          },
          (e: unknown) => {
            getLogger().warn(
              { agentId, error: (e as Error).message },
              "environment-gate.wake.failed",
            );
            if (wakeFailedAt.size > 10_000) wakeFailedAt.clear();
            wakeFailedAt.set(agentId, Date.now());
            resolve("failed");
          },
        )
        .finally(() => waking.delete(agentId));
    });
  }

  // UNIT_BOUNDARY_DESCRIPTION: what the loading page's status says: the machine's state, and once it runs, whether the endpoint's app is ready.
  async function startState(
    resolved: Resolved,
    machineState: MachineState,
    publicHost: string | undefined,
  ): Promise<"ready" | "starting" | "failed"> {
    if (machineState === "failed") return "failed";
    if (machineState === "waking") return "starting";
    return (await readiness.ready(probeTarget(resolved, publicHost)))
      ? "ready"
      : "starting";
  }

  // UNIT_BOUNDARY_DESCRIPTION: whether a page load waits on the loading page although the machine runs: only for an endpoint that declared a readiness path, until that path answers. Without one, the page load goes to the app, and its own answer decides (see relay).
  async function pageWaits(c: Context, resolved: Resolved) {
    if (!isPageLoad(c) || resolved.ready === undefined) return false;
    return !(await readiness.ready(
      probeTarget(resolved, c.req.header("host")),
    ));
  }

  // UNIT_BOUNDARY_DESCRIPTION: the gate's answer when nothing behind an endpoint can answer yet: a page load gets the loading page, which checks the gate's status and opens the app once it answers, or says it did not start; anything else, a script's call or an API client, gets a plain 503, never a page or a 200 a monitor would read as up. Both ask to be tried again after a few seconds.
  function notReady(
    c: Context,
    record: EnvironmentRecord,
    state: "starting" | "failed",
  ) {
    gateHeaders(c);
    c.header("Retry-After", String(RETRY_AFTER_S));
    siblingCors(c, record);
    if (!isPageLoad(c))
      return c.text(
        state === "failed"
          ? "The Environment could not be started."
          : "The Environment is starting.",
        503,
      );
    const url = new URL(c.req.url);
    return c.html(
      state === "failed"
        ? renderGatePage({
            brandName: deps.brandName,
            title: "Did not start",
            body: "The Environment could not be started.",
            retry: `${START_PATH}?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
          })
        : renderGatePage({
            brandName: deps.brandName,
            title: "Starting…",
            body: "The Environment is starting. This page opens it as soon as it is ready.",
            waitFor: { statusPath: STATUS_PATH, slowAfterMs: SLOW_AFTER_MS },
          }),
      503,
    );
  }

  function gateHeaders(c: Context) {
    for (const [name, value] of Object.entries(GATE_HEADERS))
      c.header(name, value);
  }

  function page(
    c: Context,
    status: 401 | 403 | 404 | 400,
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

  // UNIT_BOUNDARY_DESCRIPTION: a request the loading page may stand in for: a browser opening a page. A browser names every request's kind in Sec-Fetch-Mode, so a script's fetch that accepts HTML is never taken for one; only a client that sends no such header is judged by what it accepts.
  function isPageLoad(c: Context) {
    const mode = c.req.header("sec-fetch-mode");
    if (mode !== undefined)
      return (
        mode === "navigate" &&
        (c.req.method === "GET" || c.req.method === "HEAD")
      );
    return isNavigation(c);
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
      if (!redeemed) {
        securityLog("warn", "environment.session", {
          category: "authn",
          actor: null,
          actorKind: "user",
          agentId: record.agentId,
          result: "failure",
          reason: "handoff-refused",
          detail: { address },
        });
        return page(
          c,
          400,
          "Sign-in expired",
          "This sign-in link was used, has expired, or was opened in another browser. Open the Environment's link again.",
        );
      }
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
      readiness.failed(probeTarget(resolved, c.req.header("host")));
      return notReady(c, resolved.record, "starting");
    }
    if (
      answer.headers.has(UNREACHABLE_HEADER) ||
      (isPageLoad(c) &&
        resolved.ready === undefined &&
        isProxyWaiting(answer.status))
    ) {
      void answer.body?.cancel().catch(() => {});
      readiness.failed(probeTarget(resolved, c.req.header("host")));
      return notReady(c, resolved.record, "starting");
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
    // UNIT_BOUNDARY_DESCRIPTION: an Agent Key is for the Environment gate alone; a request that carries one to any other host of the api-server is refused before any route reads it.
    if (resolved === null && c.req.header(AGENT_KEY_HEADER) !== undefined) {
      gateHeaders(c);
      return c.text("An agent key opens Environment addresses only.", 421);
    }
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
    const agentKey = agentKeyOf(c.req.header(AGENT_KEY_HEADER));
    const startPath = c.req.path === STATUS_PATH || c.req.path === START_PATH;
    if (
      agentKey !== undefined &&
      c.req.path.startsWith(RESERVED_PREFIX) &&
      !startPath
    )
      return page(
        c,
        403,
        "Refused",
        "An agent opens an Environment without signing in.",
      );
    if (c.req.path.startsWith(RESERVED_PREFIX) && !startPath)
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

    if (agentKey !== undefined) {
      const agent = await agentAccess(record, agentKey);
      if (!agent.access.allow) {
        denyAgent(record, agent.visitor, address);
        siblingCors(c, record);
        return page(
          c,
          403,
          "You don't have access",
          agent.visitor
            ? "This agent is not on this Environment's list. Ask its owner to add the agent's id in its Share dialog."
            : "This agent's key is not known here.",
        );
      }
      agentVisited(record, agent.visitor!, address);
      return admitted(c, resolved);
    }

    const visitor = await session(getCookie(c, cookieName));
    const access = decideAccess(
      record,
      effectiveAccess(
        await deps.agentMembers(record.owningAgentId),
        await deps.environmentMembers(record.agentId),
        await deps.editorsOf(record.owningAgentId),
      ),
      visitor,
      address,
    );
    if (!access.allow) {
      deny(record, visitor, address, access.reason);
      siblingCors(c, record);
      if (access.reason === "not-signed-in") {
        if (isPageLoad(c)) {
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
        gateHeaders(c);
        return c.text("Not signed in to this Environment address.", 401);
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

    const completion = await completeSignIn(c, resolved, visitor);
    if (completion) return completion;
    return admitted(c, resolved);
  };

  // UNIT_BOUNDARY_DESCRIPTION: a page load of an endpoint with a session (the top document, never a frame, which the front door refuses to be shown in, and never the loading page's own paths), in an Environment whose other endpoints the same sign-in left without one, or whose session there is gone: the browser passes through those endpoints and comes back to the page, so an app's call to them finds a session. Without this the app breaks for good, since its address's session still holds and no page load ever goes through the front door again.
  async function completeSignIn(
    c: Context,
    resolved: Resolved,
    visitor: EnvironmentSession | null,
  ): Promise<Response | null> {
    const sessionId = getCookie(c, cookieName);
    if (
      visitor === null ||
      c.req.path.startsWith(RESERVED_PREFIX) ||
      !isPageLoad(c) ||
      (c.req.header("sec-fetch-dest") ?? "document") !== "document" ||
      sessionId === undefined
    )
      return null;
    const others = endpointAddresses(resolved.record).filter(
      (a) => a !== resolved.address,
    );
    if (others.length === 0) return null;
    const url = new URL(c.req.url);
    const completion = await deps.signIn.completeSignIn(
      sessionId,
      visitor,
      others,
      `${deps.scheme}://${c.req.header("host") ?? ""}${safeNext(`${url.pathname}${url.search}`)}`,
    );
    if (!completion) return null;
    securityLog("info", "environment.signin_complete", {
      category: "authn",
      actor: visitor.sub,
      actorKind: "user",
      agentId: resolved.record.agentId,
      detail: { address: resolved.address, missing: completion.missing },
    });
    gateHeaders(c);
    return c.redirect(completion.hop, 302);
  }

  // UNIT_BOUNDARY_DESCRIPTION: what a visitor the gate let in gets, a person or an Agent alike: the start and status paths of the loading page, the loading page itself while the app is not ready, and the app once it is.
  async function admitted(c: Context, resolved: Resolved): Promise<Response> {
    const { record } = resolved;
    if (c.req.path === START_PATH) {
      wakeFailedAt.delete(record.agentId);
      gateHeaders(c);
      return c.redirect(safeNext(c.req.query("next")), 302);
    }
    const machineState = await machine(record.agentId);
    if (machineState !== "failed") stamp(record.agentId);
    if (c.req.path === STATUS_PATH) {
      gateHeaders(c);
      return c.json({
        state: await startState(resolved, machineState, c.req.header("host")),
      });
    }
    if (machineState !== "ready")
      return notReady(
        c,
        record,
        machineState === "failed" ? "failed" : "starting",
      );
    if (await pageWaits(c, resolved)) return notReady(c, record, "starting");
    return relay(c, resolved);
  }

  function refuseUpgrade(socket: Duplex, status: string) {
    const retry = status.startsWith("503")
      ? `Retry-After: ${RETRY_AFTER_S}\r\n`
      : "";
    socket.end(
      `HTTP/1.1 ${status}\r\nCache-Control: no-store\r\n${retry}Connection: close\r\n\r\n`,
    );
  }

  // UNIT_BOUNDARY_DESCRIPTION: passes the app's answer to a WebSocket upgrade on to the visitor without its Set-Cookie lines, which no rule would filter there, then hands the socket over. An app sets cookies over HTTP, where the relay filters them. An app that closes before it answered closes the visitor's socket too, and one the runtime found nothing listening for is a 503 to try again.
  function relayHandshake(
    upstream: Duplex,
    socket: Duplex,
    then: () => void,
    unreachable: () => void,
  ) {
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
      const lines = buffered.subarray(0, end).toString("latin1").split("\r\n");
      if (
        lines.some((line) =>
          line.toLowerCase().startsWith(`${UNREACHABLE_HEADER}:`),
        )
      ) {
        upstream.destroy();
        unreachable();
        return refuseUpgrade(socket, "503 Service Unavailable");
      }
      const head = lines
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
    if (parseAddress(req.headers.host, deps.domain) === null) {
      if (req.headers[AGENT_KEY_HEADER] === undefined) return false;
      socket.on("error", () => socket.destroy());
      refuseUpgrade(socket, "421 Misdirected Request");
      return true;
    }
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
      const agentKey = agentKeyOf(req.headers[AGENT_KEY_HEADER]);
      if (agentKey !== undefined) {
        const agent = await agentAccess(resolved.record, agentKey);
        if (!agent.access.allow) {
          denyAgent(resolved.record, agent.visitor, resolved.address);
          return refuseUpgrade(socket, "403 Forbidden");
        }
        agentVisited(resolved.record, agent.visitor!, resolved.address);
      } else {
        const cookie = cookieValue(req.headers.cookie, cookieName);
        const visitor = await session(cookie);
        const access = decideAccess(
          resolved.record,
          effectiveAccess(
            await deps.agentMembers(resolved.record.owningAgentId),
            await deps.environmentMembers(resolved.record.agentId),
            await deps.editorsOf(resolved.record.owningAgentId),
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
      }
      if ((await machine(resolved.record.agentId)) !== "ready")
        return refuseUpgrade(socket, "503 Service Unavailable");
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
        relayHandshake(
          upstream,
          socket,
          () => {
            upstream.pipe(socket);
            socket.pipe(upstream);
          },
          () => readiness.failed(probeTarget(resolved, req.headers.host)),
        );
      });
      socket.on("data", () => stamp(resolved.record.agentId));
      const close = () => {
        upstream.destroy();
        socket.destroy();
      };
      upstream.on("error", () => {
        if (socket.writable) refuseUpgrade(socket, "503 Service Unavailable");
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
