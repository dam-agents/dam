import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { Readable } from "node:stream";
import {
  parseQualifiedModel,
  PLATFORM_REFUSAL_HEADER,
  type ProviderAlias,
} from "api-server-api";
import type {
  CatalogEntry,
  CatalogProvider,
  ModelDialect,
} from "../../model-catalog/index.js";
import type { ModelRouterBinding } from "../../runtime-channel/manifest.js";
import type { RuntimeEnvState } from "../../runtime-channel/infrastructure/env-state-store.js";
import { ANTHROPIC_OAUTH_TEMPLATE } from "../../model-catalog/index.js";
import { anthropicBetaFor } from "../domain/anthropic-beta.js";
import { bobGatewayPath, classify } from "../domain/classify.js";
import {
  isSideCall,
  SESSION_HEADER,
  type SessionHandle,
} from "../domain/session-of.js";
import { resolveTarget } from "../domain/resolve-target.js";
import { tierModelOnSessionProvider } from "../domain/tier-slots.js";
import { withSubagentEffort } from "../domain/subagent-effort.js";
import { upstreamUrl, upstreamWireOf } from "../domain/upstream.js";
import { explainUpstreamError } from "../domain/upstream-error.js";
import { createSseModelRewrite, rewriteBody } from "../domain/model-rewrite.js";
import {
  createUsageScanner,
  traceOf,
  usageOfBody,
  type ModelUsage,
  type UncountedReason,
} from "../domain/usage.js";

export const MODEL_ROUTER_DEFAULT_PORT = 24180;
export const HARNESS_HEADER = "x-platform-harness";

export interface ModelCallRecord {
  connectionId: string;
  alias: ProviderAlias;
  upstreamId: string;
  requestedModel: string;
  dialect: ModelDialect;
  harness: string;
  session: string | null;
  stream: boolean;
  status: number;
  startedAt: string;
  durationMs: number;
  usage: ModelUsage | null;
  uncounted: UncountedReason | null;
  requestId: string | null;
  trace: { traceId: string; spanId: string } | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: model is null on the harness's default, when the
 * body's own model stands; the subagent model is set on its own so such a
 * session can still send its subagents elsewhere.
 */
export interface SessionModelChoice {
  model: string | null;
  subagentModel?: string | null;
  subagentEffort?: string | null;
}

export type { SessionHandle } from "../domain/session-of.js";

export interface RouterExtension {
  name: string;
  handle(ctx: {
    req: IncomingMessage;
    res: ServerResponse;
    path: string;
    harness: string;
  }): boolean | Promise<boolean>;
}

export interface ModelRouterDeps {
  catalog: { providers(): CatalogProvider[] };
  envState: () => RuntimeEnvState;
  harnesses: Readonly<Record<string, ModelRouterBinding | undefined>>;
  defaultHarness: string;
  sessionOf?: (
    req: IncomingMessage,
    body: Record<string, unknown>,
    harness: string,
  ) => SessionHandle | null;
  sessionModelOf?: (sessionId: string) => SessionModelChoice | null;
  prepareBody?: (
    body: Record<string, unknown>,
    target: { entry: CatalogEntry; dialect: ModelDialect; stream: boolean },
  ) => Record<string, unknown>;
  extensions?: readonly RouterExtension[];
  onCall?: (record: ModelCallRecord) => void;
  onCallStarted?: (session: string | null) => void;
  onCallEnded?: (session: string | null, answered: boolean) => void;
  onRefused?: (refusal: ModelRefusal) => void;
  fetchImpl?: typeof globalThis.fetch;
  port?: number;
  log: (msg: string) => void;
}

export interface ModelRefusal {
  session: string | null;
  status: number;
  text: string;
  permanent: boolean;
}

export interface ModelRouter {
  readonly port: number;
  readonly baseUrl: string;
  setSessionModel(sessionId: string, choice: SessionModelChoice): void;
  clearSessionModel(sessionId: string): void;
  listen(): Promise<void>;
  close(): Promise<void>;
}

const REQ_DROP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
  "authorization",
  "x-api-key",
  HARNESS_HEADER,
  SESSION_HEADER,
]);
const RES_DROP = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: provider errors a retry cannot change. The
 * harnesses' client SDKs retry them for a minute or more unless told not to,
 * so the router adds `x-should-retry: false` where the provider set none.
 */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 422]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: a stamp the gateway's meter accepts: at most 128
 * characters of printable ASCII. A Claude Code `user_id` can hold any text,
 * and a header value fetch refuses would fail the call, so such a session
 * goes unstamped.
 */
const STAMP_VALUE = /^[\x20-\x7e]{1,128}$/;

function errorBody(dialect: ModelDialect | null, message: string): string {
  return dialect === "anthropic-messages"
    ? JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message },
      })
    : JSON.stringify({
        error: { message, type: "invalid_request_error", code: null },
      });
}

function reply(
  res: ServerResponse,
  status: number,
  dialect: ModelDialect | null,
  message: string,
): void {
  res
    .writeHead(status, { "content-type": "application/json" })
    .end(errorBody(dialect, `model-router: ${message}`));
}

const keep = (
  entries: Iterable<[string, string | string[] | undefined]>,
  drop: Set<string>,
): Record<string, string> =>
  Object.fromEntries(
    [...entries].filter(
      (pair): pair is [string, string] =>
        !drop.has(pair[0]) && typeof pair[1] === "string",
    ),
  );

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Model Router, the loopback listener every
 * harness process points its one base URL at. It resolves each call's model
 * to a catalog entry and forwards the call to that provider Connection's host
 * with the Connection's credential placeholder, which Envoy swaps for the
 * key; the client's own credential never leaves the pod. No retries: a
 * second model call is a second bill.
 */
export function createModelRouter(deps: ModelRouterDeps): ModelRouter {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const wantPort = deps.port ?? MODEL_ROUTER_DEFAULT_PORT;
  let port = wantPort;
  const sessionModels = new Map<string, SessionModelChoice>();
  const choiceOf = (sessionId: string): SessionModelChoice | null =>
    sessionModels.get(sessionId) ?? deps.sessionModelOf?.(sessionId) ?? null;

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a subagent's call runs on the session's
   * subagent model whatever it asked for, since the harness gives it the
   * session's model or a built-in name. A harness that cannot switch its own
   * model per session (modelFromSession), a tier alias, or a bare name on a
   * bareNamesFromSession harness gets the session's model, which would
   * otherwise resolve on whatever provider lists that name. On a claudeTiers
   * harness a side call, one Claude Code classes as auxiliary or a
   * subagent's, for a tier slot of another provider, or one its own provider
   * no longer lists, runs on the session provider's model of that tier; a
   * main-conversation turn is never moved, since it names the model the
   * session was given.
   */
  const modelFor = (
    requested: string,
    binding: ModelRouterBinding | undefined,
    handle: SessionHandle | null,
    side: boolean,
    harness: string,
  ): string => {
    if (!handle) return requested;
    const choice = choiceOf(handle.parentSessionId ?? handle.sessionId);
    if (handle.parentSessionId && choice?.subagentModel)
      return choice.subagentModel;
    const tier =
      binding?.tierAliases?.includes(requested) === true ||
      (binding?.bareNamesFromSession === true &&
        parseQualifiedModel(requested) === null);
    if (!choice?.model) return requested;
    if (binding?.modelFromSession || tier) return choice.model;
    if (!binding?.claudeTiers || !side) return requested;
    return (
      tierModelOnSessionProvider({
        requested,
        sessionModel: choice.model,
        harness,
        binding,
        providers: deps.catalog.providers(),
      }) ?? requested
    );
  };

  const handleModel = async (
    req: IncomingMessage,
    res: ServerResponse,
    dialect: ModelDialect,
    path: string,
    search: string,
    harness: string,
    billed: boolean,
  ): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return reply(res, 400, dialect, "request body is not a JSON object");
    }
    if (typeof body.model !== "string" || !body.model)
      return reply(res, 400, dialect, "request names no model");
    const handle = deps.sessionOf?.(req, body, harness) ?? null;
    const session = handle
      ? (handle.parentSessionId ?? handle.sessionId)
      : null;
    const binding = deps.harnesses[harness];
    const target = resolveTarget({
      model: modelFor(body.model, binding, handle, isSideCall(req), harness),
      dialect,
      harness: binding,
      harnessName: harness,
      providers: deps.catalog.providers(),
      sessionModel: session ? (choiceOf(session)?.model ?? null) : null,
    });
    if (!target.ok) {
      deps.onRefused?.({
        session,
        status: target.status,
        text: target.reason,
        permanent: true,
      });
      return reply(res, target.status, dialect, target.reason);
    }
    const { entry, publicName } = target;
    const layer = deps
      .envState()
      .providers.find((l) => l.id === entry.connectionId);
    const wire = layer ? upstreamWireOf(entry.template, layer.env) : null;
    if (!wire) {
      const text = `provider '${entry.alias}' has no endpoint in this pod's env`;
      deps.onRefused?.({ session, status: 503, text, permanent: false });
      return reply(res, 503, dialect, text);
    }
    const stream = body.stream === true;
    const subagentEffort = handle?.parentSessionId
      ? choiceOf(handle.parentSessionId)?.subagentEffort
      : null;
    const asked = subagentEffort
      ? withSubagentEffort(body, dialect, subagentEffort)
      : body;
    const prepared =
      deps.prepareBody?.(asked, { entry, dialect, stream }) ?? asked;
    const outgoing = Buffer.from(
      JSON.stringify({ ...prepared, model: entry.upstreamId }),
    );
    const headers: Record<string, string> = {
      ...keep(Object.entries(req.headers), REQ_DROP),
      "content-type": "application/json",
    };
    if (wire.credential)
      headers[wire.credential.header] = wire.credential.value;
    if (STAMP_VALUE.test(harness)) headers[HARNESS_HEADER] = harness;
    if (session && STAMP_VALUE.test(session)) headers[SESSION_HEADER] = session;
    const beta = anthropicBetaFor(
      headers["anthropic-beta"],
      entry.template === ANTHROPIC_OAUTH_TEMPLATE,
    );
    if (beta) headers["anthropic-beta"] = beta;
    else delete headers["anthropic-beta"];

    const ac = new AbortController();
    const startedAt = new Date();
    const trace = traceOf(req.headers.traceparent);
    let recorded = false;
    let upstreamHeaders: Headers | null = null;
    const record = (status: number, usage: ModelUsage | null): void => {
      if (recorded) return;
      recorded = true;
      deps.onCallEnded?.(session, status < 400);
      if (!billed) return;
      const uncounted: UncountedReason | null =
        usage === null
          ? status >= 400 && status !== 499
            ? "error"
            : "no-usage-event"
          : null;
      deps.onCall?.({
        connectionId: entry.connectionId,
        alias: entry.alias,
        upstreamId: entry.upstreamId,
        requestedModel: body.model as string,
        dialect,
        harness,
        session,
        stream,
        status,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        usage,
        uncounted,
        requestId:
          upstreamHeaders?.get("request-id") ??
          upstreamHeaders?.get("x-request-id") ??
          null,
        trace,
      });
    };
    let streamed: { usage(): ModelUsage | null; completed(): boolean } | null =
      null;
    let upstreamStatus = 499;
    let upstreamBroke = false;
    const brokeUpstream = (reason: string): void => {
      if (ac.signal.aborted || upstreamBroke) return;
      upstreamBroke = true;
      deps.log(
        `[model-router] ${harness} ${entry.alias}/${entry.upstreamId} (${dialect}): upstream stream broke (${reason})`,
      );
    };
    res.on("close", () => {
      if (res.writableEnded) return;
      ac.abort();
      if (streamed?.completed()) record(upstreamStatus, streamed.usage());
      else record(upstreamBroke ? 502 : 499, null);
    });
    const onceSent = (fn: () => void): void => {
      res.on("finish", fn);
      res.on("close", fn);
    };

    deps.onCallStarted?.(session);
    if (res.destroyed) return record(499, null);
    let upstream: Response;
    try {
      upstream = await doFetch(upstreamUrl(wire, dialect, path, search), {
        method: "POST",
        headers,
        body: outgoing,
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return record(499, null);
      const reason =
        (err as { cause?: Error }).cause?.message ?? (err as Error).message;
      deps.log(
        `[model-router] ${entry.alias}/${entry.upstreamId}: upstream unreachable (${reason})`,
      );
      record(502, null);
      return reply(res, 502, dialect, `upstream unreachable: ${reason}`);
    }
    upstreamHeaders = upstream.headers;
    const resHeaders = keep([...upstream.headers], RES_DROP);
    const contentType = upstream.headers.get("content-type") ?? "";
    const isSse = contentType.includes("text/event-stream");
    if (upstream.status >= 400) {
      const text = await upstream.text().catch(() => "");
      deps.log(
        `[model-router] ${harness} ${entry.alias}/${entry.upstreamId} (${dialect}) → ${upstream.status}: ${text.replace(/\s+/g, " ").slice(0, 400)}`,
      );
      deps.onRefused?.({
        session,
        status: upstream.status,
        text,
        permanent: PERMANENT_STATUSES.has(upstream.status),
      });
      if (upstream.headers.has(PLATFORM_REFUSAL_HEADER)) {
        res.writeHead(upstream.status, resHeaders);
        onceSent(() => record(upstream.status, null));
        res.end(text);
        return;
      }
      const explained = explainUpstreamError({
        status: upstream.status,
        text,
        dialect,
        harness,
        provider:
          deps.catalog
            .providers()
            .find((p) => p.connectionId === entry.connectionId)?.displayName ??
          entry.alias,
        upstreamId: entry.upstreamId,
      });
      res.writeHead(upstream.status, {
        ...resHeaders,
        "content-type": "application/json",
        ...(PERMANENT_STATUSES.has(upstream.status) &&
          !upstream.headers.has("x-should-retry") && {
            "x-should-retry": "false",
          }),
      });
      onceSent(() => record(upstream.status, null));
      res.end(explained);
      return;
    }
    res.writeHead(upstream.status, resHeaders);
    if (!upstream.body) {
      onceSent(() => record(upstream.status, null));
      res.end();
      return;
    }
    if (isSse) {
      const scanner = createUsageScanner(dialect);
      streamed = scanner;
      upstreamStatus = upstream.status;
      onceSent(() => record(upstream.status, scanner.usage()));
      const source = Readable.fromWeb(upstream.body as never);
      source.on("error", (err: Error) => {
        brokeUpstream(err.message);
        res.destroy();
      });
      source
        .pipe(scanner)
        .pipe(createSseModelRewrite(dialect, publicName))
        .pipe(res);
      return;
    }
    let text: string;
    try {
      text = await upstream.text();
    } catch (err) {
      brokeUpstream((err as Error).message);
      res.destroy();
      return;
    }
    onceSent(() => record(upstream.status, usageOfBody(dialect, text)));
    res.end(
      upstream.ok && contentType.includes("json")
        ? rewriteBody(dialect, text, publicName)
        : text,
    );
  };

  const bobHarness = Object.entries(deps.harnesses).find(
    ([, binding]) => binding?.bobGateway,
  )?.[0];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const harness =
      (req.headers[HARNESS_HEADER] as string | undefined)?.trim() ||
      (bobHarness && bobGatewayPath(url.pathname) ? bobHarness : null) ||
      deps.defaultHarness;
    const route = classify(req.method ?? "GET", url.pathname);
    void (async () => {
      if (route.kind === "model") {
        await handleModel(
          req,
          res,
          route.dialect,
          route.path,
          url.search,
          harness,
          route.billed,
        );
        return;
      }
      if (req.method === "HEAD" && route.path === "/api/hello") {
        res.writeHead(200).end();
        return;
      }
      for (const ext of deps.extensions ?? []) {
        if (await ext.handle({ req, res, path: route.path, harness })) return;
      }
      reply(
        res,
        404,
        null,
        `no route for ${req.method ?? "GET"} ${route.path}`,
      );
    })().catch((err: Error) => {
      deps.log(
        `[model-router] ${req.method ?? ""} ${url.pathname}: ${err.message}`,
      );
      if (!res.headersSent) reply(res, 500, null, err.message);
      else res.destroy();
    });
  });

  return {
    get port() {
      return port;
    },
    get baseUrl() {
      return `http://127.0.0.1:${port}`;
    },
    setSessionModel: (sessionId, choice) => {
      sessionModels.set(sessionId, choice);
    },
    clearSessionModel: (sessionId) => {
      sessionModels.delete(sessionId);
    },
    async listen() {
      server.listen(wantPort, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (address && typeof address === "object") port = address.port;
      deps.log(`[model-router] listening on 127.0.0.1:${port}`);
    },
    async close() {
      if (!server.listening) return;
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}
