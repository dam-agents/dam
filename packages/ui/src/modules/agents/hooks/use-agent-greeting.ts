import { useEffect, useRef } from "react";

import { useAcpSessions } from "../../sessions/api/queries.js";
import type { SendPromptOptions } from "../../sessions/hooks/use-acp-prompt.js";
import { useAgentRunState } from "../api/queries.js";

export interface AgentGreetingOptions {
  agentId: string | null;
  /** True only on the surface that owns this greeting. */
  active: boolean;
  /** True while nothing is open — no selected session, no drafted messages. */
  idle: boolean;
  /** The onboarding command the agent's Install Command put in place. */
  command: string;
  /** While false the greeting waits, so it can't send a command the Install
   *  Command hasn't delivered. Omit when there's nothing to probe. */
  setupReady?: boolean;
  sendPrompt: (
    text: string,
    attachments?: undefined,
    sendOpts?: SendPromptOptions,
  ) => Promise<void>;
}

/** Send a kinded agent's onboarding command once, on the user's behalf, so a
 *  fresh sandbox opens with the agent greeting them instead of an empty chat.
 *  Only ever on an agent with no sessions at all, and only while it's running so
 *  it neither hits a booting pod nor toasts a session-list error.
 *
 *  Shared by Knowledge Bases and Experiments; they differ in the command and
 *  whether they can prove their setup finished. */
export function useAgentGreeting(opts: AgentGreetingOptions) {
  const { agentId, active, idle, command, setupReady, sendPrompt } = opts;
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
    // Re-read the claim inside the effect: `armed` was computed during render, so
    // StrictMode's dev double-invoke would otherwise send the command twice.
    if (greetedForAgentRef.current === agentId) return;
    // Prior conversations greet no one. Claim it anyway so we stop probing.
    if (sessions.length > 0) {
      greetedForAgentRef.current = agentId;
      return;
    }
    // Stay armed so a later render fires once the command exists.
    if (setupReady === false) return;
    // Claim before sending so a re-render mid-flight can't double-fire.
    greetedForAgentRef.current = agentId;
    // Hidden: no user bubble, so it reads as the agent speaking first.
    void sendPrompt(command, undefined, { hidden: true });
  }, [armed, agentId, sessions, setupReady, command, sendPrompt]);
}
