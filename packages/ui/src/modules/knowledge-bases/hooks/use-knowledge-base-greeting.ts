import { useEffect, useRef } from "react";

import { useAgentRunState } from "../../agents/api/queries.js";
import { useAcpSessions } from "../../sessions/api/queries.js";

/** The onboarding command the LLM Wiki toolkit installs; running it makes the
 *  agent greet the user and propose next steps. */
const ONBOARD_COMMAND = "/wiki-onboard";

/** On a freshly-created knowledge base — its standalone page, no session yet —
 *  send the onboarding command once on the user's behalf, so the first thing
 *  they see is the agent greeting them rather than an empty chat. Fires only
 *  when the KB has no sessions at all; once the greeting session exists this
 *  never triggers again, and a KB opened with prior conversations is left
 *  alone. Gated on the agent running (like the sessions sidebar) so it neither
 *  hits a booting pod nor raises a session-list error toast. */
export function useKnowledgeBaseGreeting(opts: {
  agentId: string | null;
  active: boolean;
  /** True while nothing is open — no selected session, no drafted messages. */
  idle: boolean;
  sendPrompt: (text: string) => Promise<void>;
}) {
  const { agentId, active, idle, sendPrompt } = opts;
  const greetedForAgentRef = useRef<string | null>(null);
  const runState = useAgentRunState(agentId);
  const armed =
    active &&
    idle &&
    agentId !== null &&
    runState === "running" &&
    greetedForAgentRef.current !== agentId;

  const { data: sessions } = useAcpSessions(
    agentId,
    { channels: false, scheduled: false },
    { enabled: armed },
  );

  useEffect(() => {
    if (!armed || !agentId || sessions === undefined) return;
    // Claim this agent before any await so a re-render mid-send can't double-fire.
    greetedForAgentRef.current = agentId;
    // A KB with prior conversations greets no one — only a truly fresh one.
    if (sessions.length > 0) return;
    void sendPrompt(ONBOARD_COMMAND);
  }, [armed, agentId, sessions, sendPrompt]);
}
