import { request as httpRequest } from "node:http";
import { Readable, Transform } from "node:stream";
import type { Context } from "hono";
import type { UserIdentity } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType, type TurnOutcome } from "../../../events.js";
import {
  isAgentStoppedError,
  isAgentWakeTimeoutError,
} from "../../../modules/agents/index.js";
import { podBaseUrl } from "../../../modules/agents/infrastructure/k8s.js";
import { clientIp, hasAgentBinding, hasScope } from "../admission/auth.js";

const PROXY_RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-type",
  "content-length",
]);
// RFC 7230 §6.1 hop-by-hop headers + auth — never forwarded upstream.
// `transfer-encoding: chunked` alongside `content-length` from a buggy
// or hostile client is a request-smuggling shape; strip both `te` and
// `transfer-encoding` so the upstream sees only a single consistent
// framing signal.
const PROXY_HOP_BY_HOP_HEADERS = new Set([
  "host",
  "authorization",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "expect",
]);

export interface ImportProxyDeps {
  namespace: string;
  maxImportBundleBytes: number;
  verifyOwner: (agentId: string, ownerSub: string) => Promise<boolean>;
  ensureReady: (agentId: string) => Promise<unknown>;
}

type ImportCtx = Context<{
  Variables: { user: UserIdentity; roles: string[] };
}>;

/** File import — bundle is a tar (or tar.gz) inside multipart/form-data:
 *  we wake the pod via the reachability primitive and stream the body
 *  straight to agent-runtime, which lands it under `<homeDir>/work` with
 *  top-level replace semantics.
 *
 *  This route is why app.ts disables Node's server-wide `requestTimeout`
 *  (an absolute timer set at request start, not socket-idle — no public
 *  API scopes it per-handler): the request is held open until the
 *  agent-runtime finishes extracting + finalizing, and a multi-GB tar can
 *  take well over 5 minutes. What still bounds every route after that:
 *    - `headersTimeout = 60s` caps the headers phase;
 *    - non-import routes enforce hard body caps, so a slow body ties up a
 *      TCP connection but can't grow memory;
 *    - the pod sits behind Traefik, which has its own ingress timeouts;
 *    - agent-runtime applies inactivity (30s) + wall-clock (30min)
 *      deadlines on the import path, so stuck imports still abort.
 *
 *  The proxy uses node:http directly (NOT undici fetch). undici buffers
 *  arbitrary-sized request bodies in memory even with `duplex: "half"`,
 *  which OOMs the api-server pod on multi-GB uploads. node:http with a
 *  raw stream pipe respects backpressure end-to-end so memory stays
 *  flat regardless of body size. */
export function createImportProxy(deps: ImportProxyDeps) {
  return async (c: ImportCtx) => {
    const user = c.get("user");
    const agentId = c.req.param("id")!;
    if (!(await deps.verifyOwner(agentId, user.sub))) {
      securityLog("warn", "authz.owner_mismatch", {
        category: "authz",
        actor: user.sub,
        actorKind: "user",
        agentId,
        decision: "deny",
        reason: "not-owner",
        sourceIp: clientIp(c),
        detail: { surface: "import" },
      });
      return c.json({ error: "not found" }, 404);
    }
    // Pod-files (incl. `dam import`) is `agents:operate` — the agent itself
    // can write the same paths during a run, so import is not a new
    // capability for an agents:operate principal.
    if (!hasScope(user, "agents:operate")) {
      return c.json(
        { error: "forbidden", message: "Requires agents:operate" },
        403,
      );
    }
    if (!hasAgentBinding(user, agentId)) {
      return c.json(
        {
          error: "forbidden",
          message: `API key is not bound to agent ${agentId}`,
        },
        403,
      );
    }
    // Hard byte ceiling at the proxy boundary. Requires Content-Length so
    // a chunked-encoding client can't slip past the cap; we additionally
    // enforce the cap with a streaming byte counter below, so a client
    // lying with `Content-Length: 1` can't trickle bytes past us.
    const lengthHeader = c.req.header("content-length");
    if (!lengthHeader) {
      return c.json(
        { error: "Content-Length required for import upload" },
        411,
      );
    }
    const length = Number.parseInt(lengthHeader, 10);
    if (!Number.isFinite(length) || length < 0) {
      return c.json({ error: "invalid Content-Length" }, 400);
    }
    let emitted = false;
    const fireEmit = (outcome: TurnOutcome) => {
      if (emitted) return;
      emitted = true;
      emit({
        type: EventType.FilesImported,
        actorSub: user.sub,
        agentId,
        outcome,
        bytes: length,
      });
    };
    if (length > deps.maxImportBundleBytes) {
      fireEmit("failure");
      return c.json(
        {
          error: `bundle exceeds maximum size of ${deps.maxImportBundleBytes} bytes`,
        },
        413,
      );
    }
    try {
      await deps.ensureReady(agentId);
    } catch (err) {
      getLogger().warn(
        { agentId, error: (err as Error).message },
        "import-proxy.ensure-ready.failed",
      );
      fireEmit("failure");
      return c.json(
        {
          error: "instance unreachable",
          ...(isAgentWakeTimeoutError(err) ? { reason: err.failure.kind } : {}),
          ...(isAgentStoppedError(err) ? { reason: "stopped" } : {}),
        },
        502,
      );
    }
    const upstreamUrl = new URL(
      `http://${podBaseUrl(agentId, deps.namespace)}/api/import`,
    );
    const outHeaders: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => {
      if (PROXY_HOP_BY_HOP_HEADERS.has(k.toLowerCase())) return;
      outHeaders[k] = v;
    });

    return new Promise<Response>((resolve) => {
      // Single-shot resolve guard. Without this, both the upstream
      // response handler and the error/close handlers can race —
      // resulting in either a double-resolve (no-op in practice but
      // confusing) or, more importantly, a Promise that never resolves
      // when the *client* aborts before any upstream event fires
      // (Node may emit `close` without `error` on upstreamReq, which
      // would otherwise dangle).
      let resolved = false;
      const resolveOnce = (resp: Response) => {
        if (resolved) return;
        resolved = true;
        resolve(resp);
      };
      const upstreamReq = httpRequest(
        {
          protocol: upstreamUrl.protocol,
          hostname: upstreamUrl.hostname,
          port: upstreamUrl.port,
          path: upstreamUrl.pathname + upstreamUrl.search,
          method: "POST",
          headers: outHeaders,
        },
        (upstreamRes) => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(upstreamRes.headers)) {
            if (value === undefined) continue;
            if (!PROXY_RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase()))
              continue;
            responseHeaders.set(
              name,
              Array.isArray(value) ? value.join(", ") : value,
            );
          }
          const status = upstreamRes.statusCode ?? 502;
          fireEmit(status >= 200 && status < 300 ? "success" : "failure");
          // toWeb gives a Web ReadableStream backed by the IncomingMessage —
          // Hono streams this back to the client without buffering.
          const body = Readable.toWeb(
            upstreamRes,
          ) as ReadableStream<Uint8Array>;
          resolveOnce(
            new Response(body, {
              status,
              headers: responseHeaders,
            }),
          );
        },
      );
      upstreamReq.on("error", () => {
        fireEmit("failure");
        resolveOnce(c.json({ error: "instance unreachable" }, 502));
      });
      upstreamReq.on("close", () => {
        // Backstop: if the upstream socket closed without ever emitting
        // either `response` or `error` (Node sometimes does this on
        // mid-request aborts), the Promise would otherwise hang.
        fireEmit("failure");
        resolveOnce(c.json({ error: "instance closed connection" }, 502));
      });

      // Pipe incoming request body straight into the upstream socket.
      // Wrap with a Transform that counts bytes when the cap is on, so
      // even a lying Content-Length client can't trickle past the limit.
      const incomingBody = c.req.raw.body;
      if (!incomingBody) {
        upstreamReq.end();
        return;
      }
      const source = Readable.fromWeb(
        incomingBody as unknown as Parameters<typeof Readable.fromWeb>[0],
      );
      let seen = 0;
      const cap = deps.maxImportBundleBytes;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          seen += chunk.length;
          if (seen > cap) {
            cb(new Error(`bundle exceeds cap ${cap}B`));
            return;
          }
          cb(null, chunk);
        },
      });
      counter.on("error", () => {
        try {
          upstreamReq.destroy();
        } catch {}
        fireEmit("failure");
        resolveOnce(
          c.json({ error: `bundle exceeds maximum size of ${cap} bytes` }, 413),
        );
      });
      counter.pipe(upstreamReq);
      source
        .on("error", () => {
          try {
            upstreamReq.destroy();
          } catch {}
        })
        .pipe(counter);
    });
  };
}
