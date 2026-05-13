import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { SessionMode } from "api-server-api";
import { useCallback, useRef } from "react";

import { api } from "../../../api.js";
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
 * Either way, the response is forwarded to `captureSessionConfig` (cache +
 * localStorage) and `applySavedPreferences` (replays the user's per-instance
 * mode/model/option prefs onto the new session).
 *
 * `engagedSessionIdRef` is the source of truth for "the session this live
 * conn is currently bound to". The orchestrator's WS close handler and
 * `resetSession` call `clear()` to drop the binding.
 */
export function useAcpSessionEngagement(
  selectedInstance: string | null,
  selectedMcpServers: McpServer[],
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
  const showToast = useStore((s) => s.showToast);

  const engagedSessionIdRef = useRef<string | null>(null);

  const engage = useCallback(async (conn: ClientSideConnection) => {
    if (!selectedInstance) return;
    if (engagedSessionIdRef.current) return;

    const sid = useStore.getState().sessionId;
    if (sid) {
      const resp = await conn.unstable_resumeSession({
        sessionId: sid,
        cwd: ".",
        mcpServers: selectedMcpServers,
      });
      captureSessionConfig(resp);
      engagedSessionIdRef.current = sid;
      await applySavedPreferences(conn, sid, resp);
    } else {
      const s = await conn.newSession({
        cwd: ".",
        mcpServers: selectedMcpServers,
      });
      captureSessionConfig(s);
      setSessionId(s.sessionId);
      engagedSessionIdRef.current = s.sessionId;
      addLog("session", { sessionId: s.sessionId });
      // Persist to the platform DB as soon as the runtime returns a session
      // id — refreshing or navigating away mid-turn must still leave the
      // session in the sidebar. Fire-and-forget; engage only ever runs from
      // a user-initiated send, so this can't create rows for chats the user
      // never sent in.
      api.sessions.create
        .mutate({ sessionId: s.sessionId, instanceId: selectedInstance, mode: SessionMode.Chat })
        .then(() => queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all }))
        .catch((err) => {
          showToast({
            kind: "warning",
            message: `Couldn't save this session to your history: ${err instanceof Error ? err.message : "sync failed"}`,
          });
        });
      await applySavedPreferences(conn, s.sessionId, s);
    }
  }, [selectedInstance, selectedMcpServers, captureSessionConfig, applySavedPreferences, setSessionId, addLog, showToast]);

  const clear = useCallback(() => {
    engagedSessionIdRef.current = null;
  }, []);

  return { engagedSessionIdRef, engage, clear };
}
