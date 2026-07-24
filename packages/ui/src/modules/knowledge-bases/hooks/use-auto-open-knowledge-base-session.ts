import { SessionMode } from "api-server-api";
import { useEffect, useRef } from "react";

import { useAcpSessions } from "../../sessions/api/queries.js";

/** On the standalone knowledge-base page, open the newest chat session once
 *  instead of starting blank: the install run and its onboarding interview
 *  live in a platform-opened session the user must be able to answer. Freshly
 *  after create that session may not exist yet — the underlying query polls,
 *  and the first session to appear is opened. Fires at most once per agent so
 *  a deliberate "new session" is never yanked back. */
export function useAutoOpenKnowledgeBaseSession(opts: {
  agentId: string | null;
  active: boolean;
  /** True while nothing is open — no selected session, no drafted messages. */
  idle: boolean;
  resumeSession: (sessionId: string) => void;
}) {
  const { agentId, active, idle, resumeSession } = opts;
  const openedForAgentRef = useRef<string | null>(null);
  const armed =
    active && idle && agentId !== null && openedForAgentRef.current !== agentId;

  const { data: sessions } = useAcpSessions(
    agentId,
    { channels: false, scheduled: false },
    { enabled: armed },
  );

  useEffect(() => {
    if (!armed || !agentId) return;
    const newest = (sessions ?? [])
      .filter((s) => s.mode !== SessionMode.Terminal)
      .sort(
        (a, b) =>
          Date.parse(b.updatedAt ?? b.createdAt) -
          Date.parse(a.updatedAt ?? a.createdAt),
      )[0];
    if (!newest) return;
    openedForAgentRef.current = agentId;
    resumeSession(newest.sessionId);
  }, [armed, agentId, sessions, resumeSession]);
}
