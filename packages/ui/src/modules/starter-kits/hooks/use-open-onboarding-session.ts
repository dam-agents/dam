import { SessionType } from "api-server-api";
import { useEffect, useRef } from "react";

import { useStore } from "../../../store.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { useAcpSessions } from "../../sessions/api/queries.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Opens a kit agent's onboarding session the first
 * time its chat is shown while onboarding is pending. The runtime opens that
 * session on its own when the agent wakes, so without this the user lands on
 * an empty composer with the conversation that needs them sitting in the
 * list. Once per agent per page; the session list is the source of truth.
 */
export function useOpenOnboardingSession(opts: {
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

  const { data: sessions } = useAcpSessions(
    agentId,
    { channels: false, scheduled: false },
    { enabled: armed },
  );

  useEffect(() => {
    if (!armed || !agentId || sessions === undefined) return;
    const onboarding = sessions.find(
      (s) => s.onboarding === true && s.type === SessionType.Regular,
    );
    if (!onboarding) return;
    openedForAgentRef.current = agentId;
    resumeSession(onboarding.sessionId);
  }, [armed, agentId, sessions, resumeSession]);
}
