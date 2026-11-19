import type { ClientConnection } from "@agentclientprotocol/sdk";
import { useCallback, useRef } from "react";

import { useStore } from "../../../store.js";

export function useAcpSessionEngagement(selectedAgent: string | null): {
  engagedSessionIdRef: React.MutableRefObject<string | null>;
  engage: (conn: ClientConnection) => Promise<string | null>;
  bind: (sessionId: string) => void;
  clear: () => void;
} {
  const engagedSessionIdRef = useRef<string | null>(null);
  // Bumped by every clear(): a session/resume that started before a reset
  // answers for a connection the chat no longer uses, and never binds.
  const clearedRef = useRef(0);

  const engage = useCallback(
    async (conn: ClientConnection): Promise<string | null> => {
      if (!selectedAgent) return null;
      const sid = useStore.getState().sessionId;
      const boundSessionId = engagedSessionIdRef.current;
      // A binding to another session than the one on screen is stale: the
      // connection is engaged to the shown session again instead.
      if (boundSessionId && (sid === null || boundSessionId === sid))
        return boundSessionId;
      if (!sid) return null;

      const cleared = clearedRef.current;
      await conn.agent.request("session/resume", {
        sessionId: sid,
        cwd: ".",
        mcpServers: [],
      });
      if (cleared !== clearedRef.current) return null;
      engagedSessionIdRef.current = sid;
      return sid;
    },
    [selectedAgent],
  );

  const bind = useCallback((sessionId: string) => {
    engagedSessionIdRef.current = sessionId;
  }, []);

  const clear = useCallback(() => {
    engagedSessionIdRef.current = null;
    clearedRef.current += 1;
  }, []);

  return { engagedSessionIdRef, engage, bind, clear };
}
