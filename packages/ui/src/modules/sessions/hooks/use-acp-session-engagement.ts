import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { useCallback, useRef } from "react";

import { useStore } from "../../../store.js";

/**
 * Owns the "engage a live ACP connection with the active session" decision:
 * `unstable_resumeSession` reattaches the live channel to whatever session the
 * store holds. Creating a session is deliberately *not* here — that happens once,
 * on a first prompt's own connection (`useAcpConnection.beginSession`), so the
 * view can never be repointed at a session nobody asked for.
 *
 * `engagedSessionIdRef` is the source of truth for "the session this live
 * conn is currently bound to". The orchestrator's WS close handler and
 * `resetSession` call `clear()` to drop the binding.
 */
export function useAcpSessionEngagement(selectedAgent: string | null): {
  engagedSessionIdRef: React.MutableRefObject<string | null>;
  /** Resolves to the bound session, or null when there is nothing to bind. */
  engage: (conn: ClientSideConnection) => Promise<string | null>;
  /** Record a binding this hook didn't make, for a connection handed over. */
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
