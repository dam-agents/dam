import { useCallback } from "react";

import type { Message } from "../../../types.js";
import { openInitializedConnection } from "../../acp/acp.js";
import {
  applyUpdate,
  finalizeAllStreaming,
} from "../../acp/session-projection.js";

async function collectReplay(
  agentId: string,
  sessionId: string,
  replayBefore?: number,
): Promise<Message[]> {
  let replayed: Message[] = [];
  let ws: WebSocket | null = null;
  try {
    const conn = await openInitializedConnection(agentId, (update) => {
      replayed = applyUpdate(replayed, update);
    });
    ws = conn.ws;
    await conn.connection.loadSession({
      sessionId,
      cwd: ".",
      mcpServers: [],
      ...(replayBefore !== undefined
        ? { _meta: { platform: { replayBefore } } }
        : {}),
    });
  } finally {
    ws?.close();
  }
  return finalizeAllStreaming(replayed);
}

export function useAcpHistory(selectedAgent: string | null): {
  loadHistory: (sid: string) => Promise<Message[]>;
  loadOlderHistory: (sid: string, before: number) => Promise<Message[]>;
} {
  const loadHistory = useCallback(
    async (sid: string): Promise<Message[]> => {
      if (!selectedAgent) return [];
      return collectReplay(selectedAgent, sid);
    },
    [selectedAgent],
  );

  const loadOlderHistory = useCallback(
    async (sid: string, before: number): Promise<Message[]> => {
      if (!selectedAgent) return [];
      return collectReplay(selectedAgent, sid, before);
    },
    [selectedAgent],
  );

  return { loadHistory, loadOlderHistory };
}
