import {
  ClientSideConnection,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk/dist/acp.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import type {
  RequestPermissionRequest,
  SessionNotification,
} from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import {
  platformPromptAcceptedParamsSchema,
  platformPromptStartedParamsSchema,
  platformTurnEndedParamsSchema,
} from "api-server-api";
import type { z } from "zod";

import { getAccessToken } from "../../auth.js";
import { type PermissionOutcome, useStore } from "../../store.js";
import { withCloseRace } from "./close-race.js";
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
): Promise<{ connection: ClientSideConnection; ws: WebSocket }> {
  const { connection, ws } = await openConnection(agentId, onUpdate, opts);
  try {
    await connection.initialize({
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

function replayForOf(meta: unknown): string | undefined {
  if (typeof meta !== "object" || meta === null) return undefined;
  const platform = (meta as Record<string, unknown>).platform;
  if (typeof platform !== "object" || platform === null) return undefined;
  const replayFor = (platform as Record<string, unknown>).replayFor;
  return typeof replayFor === "string" ? replayFor : undefined;
}

function parseExtParams<T>(
  method: string,
  schema: z.ZodType<T>,
  params: Record<string, unknown>,
): T | null {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    console.warn(`[acp] ${method} schema mismatch:`, parsed.error.issues);
    return null;
  }
  return parsed.data;
}

export async function openConnection(
  agentId: string,
  onUpdate: UpdateHandler,
  opts?: { passive?: boolean },
): Promise<{ connection: ClientSideConnection; ws: WebSocket }> {
  const { stream, ws, closeReason } = await wsStream(
    await wsUrl(agentId, opts?.passive ?? false),
  );
  const raw = new ClientSideConnection(
    () => ({
      async requestPermission(params: RequestPermissionRequest) {
        return awaitPermission(params);
      },
      async sessionUpdate(params: SessionNotification) {
        onUpdate(params.update, params.sessionId, replayForOf(params._meta));
      },
      async writeTextFile() {
        return {};
      },
      async readTextFile() {
        return { content: "" };
      },
      async extNotification(method: string, params: Record<string, unknown>) {
        switch (method) {
          case "platform/turnEnded": {
            const p = parseExtParams(
              method,
              platformTurnEndedParamsSchema,
              params,
            );
            if (p)
              onUpdate(
                { sessionUpdate: "platform_turn_ended", ...p },
                p.sessionId,
              );
            return;
          }
          case "platform/promptAccepted": {
            const p = parseExtParams(
              method,
              platformPromptAcceptedParamsSchema,
              params,
            );
            if (p)
              onUpdate(
                { sessionUpdate: "platform_prompt_accepted", ...p },
                p.sessionId,
              );
            return;
          }
          case "platform/promptStarted": {
            const p = parseExtParams(
              method,
              platformPromptStartedParamsSchema,
              params,
            );
            if (p)
              onUpdate(
                { sessionUpdate: "platform_prompt_started", ...p },
                p.sessionId,
              );
            return;
          }
        }
      },
    }),
    stream,
  );
  return { connection: withCloseRace(raw, closeReason), ws };
}
