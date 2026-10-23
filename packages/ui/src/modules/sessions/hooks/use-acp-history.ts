import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import { useCallback } from "react";

import type { Message } from "../../../types.js";
import { openConnection } from "../../acp/acp.js";
import {
  applyUpdate,
  finalizeAllStreaming,
} from "../../acp/session-projection.js";

/**
 * Replay a session's history from the agent's runtime log into a fresh
 * `Message[]` via a throwaway WebSocket. Used at sidebar-click resume time
 * (initial load) and during reconnect (catching up events that landed while
 * we were offline).
 *
 * Why a throwaway socket? `loadSession` makes the runtime broadcast every
 * replayed update to the channel that called it. If we ran it on the live
 * WS, our streaming update handler would apply each replayed event on top
 * of the existing projection and double-render every message.
 *
 * **Caller contract:** the live WS (if any) must be closed before calling
 * `loadHistory`, for the same reason. This hook never touches the orchestrator's
 * live connection.
 *
 * Future: when agent-runtime grows an "events since cursor" API, the impl
 * here changes — `loadSession`+throwaway becomes a single SDK call with no
 * second WS — but the surface (`loadHistory(sid) → Message[]`) stays.
 */
export function useAcpHistory(selectedAgent: string | null): {
  loadHistory: (sid: string) => Promise<Message[]>;
} {
  const loadHistory = useCallback(
    async (sid: string): Promise<Message[]> => {
      if (!selectedAgent) return [];

      let replayed: Message[] = [];
      let ws: WebSocket | null = null;
      try {
        const conn = await openConnection(selectedAgent, (update) => {
          replayed = applyUpdate(replayed, update);
        });
        ws = conn.ws;
        await conn.connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
          },
        });
        await conn.connection.loadSession({
          sessionId: sid,
          cwd: ".",
          mcpServers: [],
        });
      } finally {
        ws?.close();
      }
      return finalizeAllStreaming(replayed);
    },
    [selectedAgent],
  );

  return { loadHistory };
}
