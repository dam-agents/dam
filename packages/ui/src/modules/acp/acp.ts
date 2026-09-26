import {
  type AnyMessage,
  client,
  type ClientConnection,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type Stream,
} from "@agentclientprotocol/sdk";

import { getAccessToken } from "../../auth.js";
import { type PermissionOutcome, useStore } from "../../store.js";
import { withCloseRace } from "./close-race.js";
import {
  frameMetaOf,
  PLATFORM_NOTIFICATION_METHODS,
  routeExtNotification,
} from "./ext-notifications.js";
import type { UpdateHandler } from "./types.js";

const WS_CONNECT_TIMEOUT_MS = 120_000;

function wsStream(url: string): Promise<{
  stream: Stream;
  ws: WebSocket;
  closeReason: () => string | null;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let closeReason: string | null = null;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connect timeout"));
    }, WS_CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      const readable = new ReadableStream<AnyMessage>({
        start(controller) {
          ws.onmessage = (e) => controller.enqueue(JSON.parse(e.data));
          ws.onclose = (e) => {
            closeReason = e.reason || null;
            try {
              controller.close();
            } catch {}
          };
          ws.onerror = (err) => {
            try {
              controller.error(err);
            } catch {}
          };
        },
      });
      const writable = new WritableStream<AnyMessage>({
        write(chunk) {
          ws.send(JSON.stringify(chunk));
        },
        close() {
          ws.close();
        },
      });
      resolve({
        stream: { readable, writable },
        ws,
        closeReason: () => closeReason,
      });
    };
    ws.onerror = reject;
  });
}

async function wsUrl(agentId: string, passive: boolean): Promise<string> {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const token = await getAccessToken();
  const suffix = passive ? "&passive=1" : "";
  return `${proto}//${location.host}/api/agents/${agentId}/acp?token=${encodeURIComponent(token)}${suffix}`;
}

const SYNTH_EGRESS_PREFIX = "_egress:";

const asExtParams = {
  parse: (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {},
};

function awaitPermission(
  params: RequestPermissionRequest,
): Promise<PermissionOutcome> {
  if (params.sessionId.startsWith(SYNTH_EGRESS_PREFIX)) {
    return new Promise<PermissionOutcome>(() => {});
  }
  return new Promise((resolve) => {
    const toolCallId = params.toolCall?.toolCallId ?? crypto.randomUUID();
    useStore.getState().addPendingPermission({
      toolCallId,
      sessionId: params.sessionId,
      toolCall: params.toolCall,
      options: params.options,
      resolve,
    });
  });
}

export async function openInitializedConnection(
  agentId: string,
  onUpdate: UpdateHandler,
  opts?: { passive?: boolean; clientInfo?: { name: string; version: string } },
): Promise<{ connection: ClientConnection; ws: WebSocket }> {
  const { connection, ws } = await openConnection(agentId, onUpdate, opts);
  try {
    await connection.agent.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      ...(opts?.clientInfo ? { clientInfo: opts.clientInfo } : {}),
    });
  } catch (err) {
    try {
      ws.close();
    } catch {}
    throw err;
  }
  return { connection, ws };
}

export async function openConnection(
  agentId: string,
  onUpdate: UpdateHandler,
  opts?: { passive?: boolean },
): Promise<{ connection: ClientConnection; ws: WebSocket }> {
  const { stream, ws, closeReason } = await wsStream(
    await wsUrl(agentId, opts?.passive ?? false),
  );
  const app = client()
    .onRequest("session/request_permission", (ctx) =>
      awaitPermission(ctx.params),
    )
    .onNotification("session/update", ({ params }) => {
      onUpdate(params.update, params.sessionId, frameMetaOf(params._meta));
    })
    .onRequest("fs/write_text_file", () => ({}))
    .onRequest("fs/read_text_file", () => ({ content: "" }));
  for (const method of PLATFORM_NOTIFICATION_METHODS) {
    app.onNotification(method, asExtParams, ({ params }) => {
      const routed = routeExtNotification(method, params);
      if (routed) onUpdate(routed.update, routed.sessionId, routed.frame);
    });
  }
  return { connection: withCloseRace(app.connect(stream), closeReason), ws };
}
