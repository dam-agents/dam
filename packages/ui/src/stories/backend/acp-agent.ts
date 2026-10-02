import type { SessionNotification } from "@agentclientprotocol/sdk";

import type { FakeServer } from "./socket";

export type SessionUpdate = SessionNotification["update"];

/** One replayed `session/update` frame; `at` is the time the runtime stamps
 *  on the frame (`_meta.platform.at`), which the chat shows next to bubbles. */
export interface ReplayFrame {
  update: SessionUpdate;
  at?: string;
}

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: {
    sessionId?: string;
    _meta?: { platform?: { loadToken?: string } };
  } & Record<string, unknown>;
}

/** A fake ACP agent: replays `history` on `session/load`, hands out ids on
 *  `session/new`, and ends every prompt turn immediately. */
export function acpAgent(
  history: () => Record<string, ReplayFrame[]>,
): FakeServer {
  return {
    onMessage(frame, send) {
      const msg = JSON.parse(frame) as RpcMessage;
      if (msg.id === undefined || !msg.method) return;
      const reply = (result: unknown) =>
        send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      const sessionId = msg.params?.sessionId ?? "";
      switch (msg.method) {
        case "initialize":
          return reply({
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
              promptCapabilities: { image: true, embeddedContext: true },
            },
            authMethods: [],
          });
        case "session/new":
          return reply({ sessionId: crypto.randomUUID() });
        case "session/list":
          return reply({ sessions: [] });
        case "session/load":
        case "session/resume": {
          // The runtime tags replayed frames with the caller's loadToken so
          // the UI collects them into the loaded transcript.
          const replayFor = msg.params?._meta?.platform?.loadToken;
          for (const { update, at } of history()[sessionId] ?? []) {
            send(
              JSON.stringify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId,
                  update,
                  _meta: { platform: { replayFor, at } },
                },
              }),
            );
          }
          return reply({ _meta: { platform: { turn: { inFlight: false } } } });
        }
        case "session/prompt":
          return reply({ stopReason: "end_turn" });
        default:
          return reply({});
      }
    },
  };
}
