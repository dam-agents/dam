import { useEffect, useRef } from "react";

import { useAcpSessions } from "../../sessions/api/queries.js";
import type { SendPromptOptions } from "../../sessions/hooks/use-acp-prompt.js";
import { useIsAgentOperable } from "../api/queries.js";

export interface AgentGreetingOptions {
  agentId: string | null;
  active: boolean;
  idle: boolean;
  command: string;
  setupReady?: boolean;
  sendPrompt: (
    text: string,
    attachments?: undefined,
    sendOpts?: SendPromptOptions,
  ) => Promise<void>;
}

export function useAgentGreeting(opts: AgentGreetingOptions) {
  const { agentId, active, idle, command, setupReady, sendPrompt } = opts;
  const greetedForAgentRef = useRef<string | null>(null);
  const operable = useIsAgentOperable(agentId);
  const armed =
    active &&
    idle &&
    agentId !== null &&
    operable &&
    greetedForAgentRef.current !== agentId;

  const { data: sessions } = useAcpSessions(
    agentId,
    { channels: false, scheduled: false },
    { enabled: armed },
  );

  useEffect(() => {
    if (!armed || !agentId || sessions === undefined) return;
    if (greetedForAgentRef.current === agentId) return;
    if (sessions.length > 0) {
      greetedForAgentRef.current = agentId;
      return;
    }
    if (setupReady === false) return;
    greetedForAgentRef.current = agentId;
    void sendPrompt(command, undefined, { hidden: true, initiator: "system" });
  }, [armed, agentId, sessions, setupReady, command, sendPrompt]);
}
