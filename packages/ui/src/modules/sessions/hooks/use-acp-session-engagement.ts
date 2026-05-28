import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { useCallback, useRef } from "react";

import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { SessionConfigPayload } from "../../acp/types.js";
import { acpSessionsKeys } from "../api/queries.js";

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
        const s = await conn.newSession({
          cwd: ".",
          mcpServers: [],
        });
        captureSessionConfig(s);
        setSessionId(s.sessionId);
        engagedSessionIdRef.current = s.sessionId;
        addLog("session", { sessionId: s.sessionId });
        // Optimistic insert so the sidebar shows the row immediately. Relay
        // writes the DB row on first prompt; the next refetch reconciles.
        const stub: SessionView = {
          sessionId: s.sessionId,
          agentId: selectedAgent,
          type: SessionType.Regular,
          mode: SessionMode.Chat,
          createdAt: new Date().toISOString(),
          scheduleId: null,
          title: null,
          updatedAt: null,
        };
        queryClient.setQueriesData<SessionView[]>(
          { queryKey: acpSessionsKeys.agentLists(selectedAgent) },
          (prev) => [stub, ...(prev ?? [])],
        );
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
