import { type SessionCategory, SessionType } from "api-server-api";
import { useEffect, useRef } from "react";

import { useStore } from "../../../store.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { useAgentSessionQuery } from "../api/queries.js";

const OPENABLE_CATEGORIES: SessionCategory[] = ["chats", "runs", "terminal"];

export function useOpenInitializationSession(opts: {
  agentId: string | null;
  active: boolean;
  idle: boolean;
  resumeSession: (sessionId: string) => void;
}) {
  const { agentId, active, idle, resumeSession } = opts;
  const openedForAgentRef = useRef<string | null>(null);
  const operable = useIsAgentOperable(agentId);
  const requestedSession = useStore((st) => st.pendingResumeSessionId);
  const armed =
    active &&
    idle &&
    requestedSession === null &&
    agentId !== null &&
    operable &&
    openedForAgentRef.current !== agentId;

  const { data: sessions } = useAgentSessionQuery(
    agentId,
    { categories: OPENABLE_CATEGORIES, limit: 1 },
    { enabled: armed },
  );

  useEffect(() => {
    if (!armed || !agentId || sessions === undefined) return;
    const newest = sessions[0];
    if (
      !newest ||
      newest.initialization !== true ||
      newest.type !== SessionType.Regular
    )
      return;
    openedForAgentRef.current = agentId;
    resumeSession(newest.sessionId);
  }, [armed, agentId, sessions, resumeSession]);
}
