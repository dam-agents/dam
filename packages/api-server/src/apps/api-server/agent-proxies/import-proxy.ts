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
        fireEmit("failure");
        resolveOnce(c.json({ error: "instance closed connection" }, 502));
      });

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
