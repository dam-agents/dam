import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { SessionMode, SessionType } from "api-server-api";
import { useCallback, useRef } from "react";

import { useStore } from "../../../store.js";
import type { SessionConfigPayload } from "../../acp/types.js";
import { optimisticInsertSession } from "../api/queries.js";

/**
 * Owns the "engage a live ACP connection with the active session" decision.
 *
 *   - If the store has a `sessionId` already → `unstable_resumeSession`
 *     reattaches the live channel (returning the SDK's snapshot of the
 *     session config so we can hydrate the popover).
 *   - If not → `newSession` creates one and commits the id to the store.
 *
 * Persistence to the platform DB is driven server-side by the api-server
 * relay on first `session/prompt` (option B). The UI never writes session
 * rows itself.
 *
 * Either way, the response is forwarded to `captureSessionConfig` (cache +
 * localStorage) and `applySavedPreferences` (replays the user's per-agent
 * mode/model/option prefs onto the new session).
 *
 * `engagedSessionIdRef` is the source of truth for "the session this live
 * conn is currently bound to". The orchestrator's WS close handler and
 * `resetSession` call `clear()` to drop the binding.
 */
export function useAcpSessionEngagement(
  selectedAgent: string | null,
  captureSessionConfig: (response: SessionConfigPayload) => void,
  applySavedPreferences: (
    conn: ClientSideConnection,
    sid: string,
    sessionResponse: SessionConfigPayload,
  ) => Promise<void>,
): {
  engagedSessionIdRef: React.MutableRefObject<string | null>;
  engage: (conn: ClientSideConnection) => Promise<void>;
  clear: () => void;
} {
  const setSessionId = useStore((s) => s.setSessionId);
  const addLog = useStore((s) => s.addLog);

  const engagedSessionIdRef = useRef<string | null>(null);

  const engage = useCallback(
    async (conn: ClientSideConnection) => {
      if (!selectedAgent) return;
      if (engagedSessionIdRef.current) return;

      const sid = useStore.getState().sessionId;
      if (sid) {
        const resp = await conn.unstable_resumeSession({
          sessionId: sid,
          cwd: ".",
          mcpServers: [],
        });
        captureSessionConfig(resp);
        engagedSessionIdRef.current = sid;
        await applySavedPreferences(conn, sid, resp);
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
        captureSessionConfig(s);
        setSessionId(s.sessionId);
        engagedSessionIdRef.current = s.sessionId;
        addLog("session", { sessionId: s.sessionId });
        optimisticInsertSession(selectedAgent, s.sessionId, SessionMode.Chat);
        await applySavedPreferences(conn, s.sessionId, s);
      }
    },
    [
      selectedAgent,
      captureSessionConfig,
      applySavedPreferences,
      setSessionId,
      addLog,
    ],
  );

  const clear = useCallback(() => {
    engagedSessionIdRef.current = null;
  }, []);

  return { engagedSessionIdRef, engage, clear };
}
