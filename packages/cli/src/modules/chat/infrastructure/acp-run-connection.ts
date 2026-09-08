import { WebSocket } from "ws";

import { proxyAgentForUrl } from "../../shared/ws-proxy.js";

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type RpcOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: JsonRpcError };

export interface RunConnection {
  request(method: string, params: unknown): Promise<RpcOutcome>;
  notify(method: string, params: unknown): void;
  closed: Promise<void>;
  close(): void;
}

export interface RunConnectionDeps {
  url: string;
  onNotification: (method: string, params: unknown) => void;
  onPermissionRequest: (request: {
    rpcId: number | string;
    params: unknown;
  }) => void;
}

const CLIENT_ANSWERED_REQUESTS: Record<string, unknown> = {
  "fs/read_text_file": { content: "" },
  "fs/write_text_file": {},
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: A raw JSON-RPC connection to an agent's ACP relay
 * for headless runs (`dam run`). The SDK's ClientSideConnection hides frame
 * `_meta` and the `platform/*` extension methods this verb depends on, so this
 * speaks frames directly: it matches responses to request ids, hands every
 * notification to the caller, and answers the agent's own requests the way the
 * session-list client does — filesystem reads answer empty, and a
 * `session/request_permission` is never answered (the platform mirrors it into
 * the approvals queue, where a human or `dam approval` resolves it) but is
 * reported so the caller can say why the run is stalled.
 */
export async function connectRun(
  deps: RunConnectionDeps,
): Promise<RunConnection> {
  const ws = new WebSocket(deps.url, { agent: proxyAgentForUrl(deps.url) });
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      resolve();
    });
    ws.on("error", reject);
  });

  let nextId = 1;
  const pending = new Map<number, (outcome: RpcOutcome) => void>();

  const closed = new Promise<void>((resolve) => {
    ws.on("close", () => {
      for (const settle of pending.values())
        settle({
          ok: false,
          error: { code: -32000, message: "connection closed" },
        });
      pending.clear();
      resolve();
    });
    ws.on("error", () => {});
  });

  ws.on("message", (data) => {
    let frame: unknown;
    try {
      frame = JSON.parse(String(data));
    } catch {
      return;
    }
    if (typeof frame !== "object" || frame === null) return;
    const f = frame as Record<string, unknown>;

    if ("id" in f && !("method" in f)) {
      const settle = typeof f.id === "number" ? pending.get(f.id) : undefined;
      if (settle === undefined) return;
      pending.delete(f.id as number);
      settle(
        "error" in f && f.error !== undefined
          ? { ok: false, error: f.error as JsonRpcError }
          : { ok: true, result: f.result },
      );
      return;
    }

    const method = typeof f.method === "string" ? f.method : "";
    if ("id" in f && f.id !== undefined && f.id !== null) {
      if (method === "session/request_permission") {
        deps.onPermissionRequest({
          rpcId: f.id as number | string,
          params: f.params,
        });
        return;
      }
      const answer = CLIENT_ANSWERED_REQUESTS[method];
      ws.send(
        JSON.stringify(
          answer === undefined
            ? {
                jsonrpc: "2.0",
                id: f.id,
                error: { code: -32601, message: `unsupported: ${method}` },
              }
            : { jsonrpc: "2.0", id: f.id, result: answer },
        ),
      );
      return;
    }

    deps.onNotification(method, f.params);
  });

  return {
    request(method, params) {
      return new Promise<RpcOutcome>((resolve) => {
        if (ws.readyState !== WebSocket.OPEN) {
          resolve({
            ok: false,
            error: { code: -32000, message: "connection closed" },
          });
          return;
        }
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    },

    notify(method, params) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    },

    closed,

    close() {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      )
        ws.close();
    },
  };
}
