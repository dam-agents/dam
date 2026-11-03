import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Readable } from "node:stream";
import { agentServiceAddress } from "../../agents/infrastructure/k8s.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent's workspace as a satellite file transfer
 * needs it, which is three calls on the runtime's own internal address: stage a
 * body under a name nobody has taken, publish it where the platform decided, or
 * read one file out. The runtime owns the paths and the byte caps; this side
 * only relays, so no file passes through the api-server's memory, and a refusal
 * is a code the runtime chose rather than an error's raw text.
 */
export interface AgentTransfer {
  stage(
    body: Readable,
    declaredBytes: number | undefined,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: "aborted" }>;
  publish(input: {
    id: string;
    path: string;
  }): Promise<
    { ok: true; path: string } | { ok: false; reason: "exists" | "refused" }
  >;
  read(
    path: string,
  ): Promise<
    | { ok: true; size: number; stream: Readable }
    | { ok: false; reason: "not-found" | "too-large" | "refused" }
  >;
}

const TRANSFER_TIMEOUT_MS = 60_000;

async function body(res: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > 4096) break;
    chunks.push(bytes);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createAgentTransfer(
  agentId: string,
  namespace: string,
): AgentTransfer {
  const send = (
    path: string,
    method: "GET" | "POST",
    payload: Readable | string | undefined,
    headers: Record<string, string>,
  ): Promise<IncomingMessage> =>
    new Promise((settle, fail) => {
      const url = new URL(`http://${agentServiceAddress(agentId, namespace)}`);
      const req = httpRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path,
          method,
          headers,
          timeout: TRANSFER_TIMEOUT_MS,
        },
        settle,
      );
      req.on("timeout", () => req.destroy(new Error("transfer timed out")));
      req.on("error", fail);
      if (payload === undefined) req.end();
      else if (typeof payload === "string") req.end(payload);
      else payload.pipe(req);
    });

  return {
    async stage(stream, declaredBytes) {
      try {
        const res = await send("/api/transfer/stage", "POST", stream, {
          "content-type": "application/octet-stream",
          ...(declaredBytes === undefined
            ? {}
            : { "content-length": String(declaredBytes) }),
        });
        const parsed = await body(res);
        return res.statusCode === 200 && typeof parsed.id === "string"
          ? { ok: true as const, id: parsed.id }
          : { ok: false as const, reason: "aborted" as const };
      } catch {
        return { ok: false, reason: "aborted" };
      }
    },

    async publish({ id, path }) {
      try {
        const payload = JSON.stringify({ id, path });
        const res = await send("/api/transfer/publish", "POST", payload, {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload)),
        });
        const parsed = await body(res);
        if (res.statusCode === 200 && typeof parsed.path === "string")
          return { ok: true, path: parsed.path };
        return {
          ok: false,
          reason: parsed.error === "already_there" ? "exists" : "refused",
        };
      } catch {
        return { ok: false, reason: "refused" };
      }
    },

    async read(path) {
      try {
        const res = await send(
          `/api/transfer/read?path=${encodeURIComponent(path)}`,
          "GET",
          undefined,
          {},
        );
        if (res.statusCode !== 200) {
          const parsed = await body(res);
          return {
            ok: false,
            reason:
              parsed.error === "not_found"
                ? "not-found"
                : parsed.error === "transfer_too_large"
                  ? "too-large"
                  : "refused",
          };
        }
        return {
          ok: true,
          size: Number(res.headers["content-length"] ?? 0),
          stream: res,
        };
      } catch {
        return { ok: false, reason: "refused" };
      }
    },
  };
}
