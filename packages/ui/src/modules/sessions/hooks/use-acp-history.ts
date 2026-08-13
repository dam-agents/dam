import { useCallback } from "react";

import type { Message } from "../../../types.js";
import { openInitializedConnection } from "../../acp/acp.js";
import {
  applyUpdate,
  finalizeAllStreaming,
} from "../../acp/session-projection.js";

export function useAcpHistory(selectedAgent: string | null): {
  loadHistory: (sid: string) => Promise<Message[]>;
} {
  const loadHistory = useCallback(
    async (sid: string): Promise<Message[]> => {
      if (!selectedAgent) return [];

      let replayed: Message[] = [];
      let ws: WebSocket | null = null;
      try {
        const conn = await openInitializedConnection(
          selectedAgent,
          (update) => {
            replayed = applyUpdate(replayed, update);
          },
        );
        ws = conn.ws;
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
