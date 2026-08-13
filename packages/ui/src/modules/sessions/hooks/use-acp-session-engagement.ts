import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { useCallback, useRef } from "react";

import { useStore } from "../../../store.js";

export function useAcpSessionEngagement(selectedAgent: string | null): {
  engagedSessionIdRef: React.MutableRefObject<string | null>;
  engage: (conn: ClientSideConnection) => Promise<string | null>;
  bind: (sessionId: string) => void;
  clear: () => void;
} {
  const engagedSessionIdRef = useRef<string | null>(null);

  const engage = useCallback(
    async (conn: ClientSideConnection): Promise<string | null> => {
      if (!selectedAgent) return null;
      const boundSessionId = engagedSessionIdRef.current;
      if (boundSessionId) return boundSessionId;

      const sid = useStore.getState().sessionId;
      if (!sid) return null;
      await conn.unstable_resumeSession({
        sessionId: sid,
        cwd: ".",
        mcpServers: [],
      });
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
  }, []);

  return { engagedSessionIdRef, engage, bind, clear };
}
