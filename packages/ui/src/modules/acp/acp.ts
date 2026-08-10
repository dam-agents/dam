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

function wsStream(url: string): Promise<{ stream: Stream; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connect timeout"));
    }, WS_CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      const readable = new ReadableStream<AnyMessage>({
        start(controller) {
          ws.onmessage = (e) => controller.enqueue(JSON.parse(e.data));
          ws.onclose = () => {
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
      resolve({ stream: { readable, writable }, ws });
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

/**
 * Hand a permission request off to the store and await the user's choice. The
 * returned promise stays pending until a human picks an option (or cancels) —
 * there is no client-side auto-approve, and no timeout. If the WebSocket dies
 * before the user responds, the agent-runtime replays the request on the next
 * connection, which overwrites the pending entry and supplies a fresh resolver.
 */
/** Synth ext_authz frames travel over the same WS as session-bound permission
 *  requests. They carry a sentinel sessionId so the UI can divert them to the
 *  inbox surface instead of the session-bound permission queue. The inbox
 *  resolves them via tRPC; the WS-side promise is left pending forever (the
 *  wrapper isn't awaiting a response on this synthetic id). */
const SYNTH_EGRESS_PREFIX = "_egress:";

function awaitPermission(
  params: RequestPermissionRequest,
): Promise<PermissionOutcome> {
  if (params.sessionId.startsWith(SYNTH_EGRESS_PREFIX)) {
    // v1: handled exclusively by the inbox UI. Return a never-resolving
    // promise so the SDK doesn't synthesize a response back to the wrapper —
    // there's no upstream listener for this id.
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

/** `openConnection` plus the `initialize` handshake every caller needs, closing
 *  the socket if the handshake fails — the one shape in which an un-owned socket
 *  can leak. */
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

/**
 * Validate a `platform/*` ext-notification's params, warning and returning
 * `null` on a mismatch. A server running a variant without our extensions (or
 * a newer contract) must degrade to "no delivery feedback", never to a thrown
 * handler that tears down the whole notification stream.
 */
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
  const { stream, ws } = await wsStream(
    await wsUrl(agentId, opts?.passive ?? false),
  );
  const raw = new ClientSideConnection(
    () => ({
      async requestPermission(params: RequestPermissionRequest) {
        return awaitPermission(params);
      },
      async sessionUpdate(params: SessionNotification) {
        onUpdate(params.update, params.sessionId);
      },
      async writeTextFile() {
        return {};
      },
      async readTextFile() {
        return { content: "" };
      },
      // Our runtime emits custom `platform/*` notifications next to the ACP
      // session updates: `platform/turnEnded` on the last response of each
      // prompt, so viewers that didn't originate the prompt can close their
      // in-progress assistant bubble, and `platform/promptAccepted` /
      // `platform/promptStarted` to tell a prompt's *sender* what the runtime
      // did with it (queued behind a running turn, or handed to the agent).
      // All three surface through the same `onUpdate` channel as synthetic
      // `sessionUpdate`s.
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
  return { connection: withCloseRace(raw), ws };
}
