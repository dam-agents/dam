// ACP protocol surface — replaced with Zod-inferred types in step 07.
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ClientSideConnection,
} from "@agentclientprotocol/sdk/dist/acp.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";

import { getAccessToken } from "../../auth.js";
import { type PermissionOption, type PermissionOutcome,useStore } from "../../store.js";

export type UpdateHandler = (update: any) => void;

const WS_CONNECT_TIMEOUT_MS = 120_000;

function wsStream(url: string): Promise<{ stream: Stream; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error("WebSocket connect timeout")); }, WS_CONNECT_TIMEOUT_MS);
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

async function wsUrl(instanceId: string): Promise<string> {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const token = await getAccessToken();
  return `${proto}//${location.host}/api/instances/${instanceId}/acp?token=${encodeURIComponent(token)}`;
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

function awaitPermission(params: {
  sessionId: string;
  toolCall?: { toolCallId?: string };
  options?: PermissionOption[];
}): Promise<PermissionOutcome> {
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
      options: params.options ?? [],
      resolve,
    });
  });
}

export async function openConnection(
  instanceId: string,
  onUpdate: UpdateHandler,
): Promise<{ connection: ClientSideConnection; ws: WebSocket }> {
  const { stream, ws } = await wsStream(await wsUrl(instanceId));
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params: any) {
        return awaitPermission(params);
      },
      async sessionUpdate(params: any) {
        onUpdate(params.update);
      },
      async writeTextFile() {
        return {};
      },
      async readTextFile() {
        return { content: "" };
      },
      // Our runtime emits a custom `humr/turnEnded` notification on the last
      // response of each prompt so viewers that didn't originate the prompt
      // can close their in-progress assistant bubble. Surface it through the
      // same `onUpdate` channel as a synthetic `sessionUpdate`.
      async extNotification(method: string, params: any) {
        if (method === "humr/turnEnded") {
          onUpdate({ sessionUpdate: "humr_turn_ended", sessionId: params?.sessionId });
        }
      },
    }),
    stream,
  );
  return { connection, ws };
}
