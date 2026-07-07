import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { SessionMode, SessionType } from "api-server-api";
import { useCallback, useRef } from "react";

import { useStore } from "../../../store.js";
import { optimisticInsertSession } from "../api/queries.js";

/**
 * Owns the "engage a live ACP connection with the active session" decision.
 *
 *   - If the store has a `sessionId` already → `unstable_resumeSession`
 *     reattaches the live channel.
 *   - If not → `newSession` creates one and commits the id to the store.
 *
 * Persistence to the platform DB is driven server-side by the api-server
 * relay on first `session/prompt` (option B). The UI never writes session
 * rows itself.
 *
 * `engagedSessionIdRef` is the source of truth for "the session this live
 * conn is currently bound to". The orchestrator's WS close handler and
 * `resetSession` call `clear()` to drop the binding.
 */
export function useAcpSessionEngagement(selectedAgent: string | null): {
  engagedSessionIdRef: React.MutableRefObject<string | null>;
  engage: (conn: ClientSideConnection) => Promise<void>;
  clear: () => void;
} {
  const setSessionId = useStore((s) => s.setSessionId);

  const engagedSessionIdRef = useRef<string | null>(null);

  const engage = useCallback(
    async (conn: ClientSideConnection) => {
      if (!selectedAgent) return;
      if (engagedSessionIdRef.current) return;

      const sid = useStore.getState().sessionId;
      if (sid) {
        await conn.unstable_resumeSession({
          sessionId: sid,
          cwd: ".",
          mcpServers: [],
        });
        engagedSessionIdRef.current = sid;
      } else {
        // Stamp platform metadata so the session records as a regular
        // chat session rather than decoding as terminal-by-default.
        const s = await conn.newSession({
          cwd: ".",
          mcpServers: [],
          _meta: {
            platform: { mode: SessionMode.Chat, type: SessionType.Regular },
          },
        });
        setSessionId(s.sessionId);
        engagedSessionIdRef.current = s.sessionId;
        optimisticInsertSession(selectedAgent, s.sessionId, SessionMode.Chat);
      }
    },
    [selectedAgent, setSessionId],
  );

  const clear = useCallback(() => {
    engagedSessionIdRef.current = null;
  }, []);

  return { engagedSessionIdRef, engage, clear };
}
