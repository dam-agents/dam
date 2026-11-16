import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useCreateDefaultAgent } from "../../agents/hooks/use-create-default-agent.js";
import { newestAgent } from "../lib/newest-agent.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one way to hand an Agent a starting line: it
 * opens the newest Agent's blank chat with the line already in the composer,
 * so the user reads it and sends it. With no Agent yet it creates one first,
 * because the line needs an Agent to answer it.
 */
export function useOpenAgentChat(): (prefill: string) => Promise<void> {
  const agents = useAgentsList();
  const createDefault = useCreateDefaultAgent();
  const leaveChatContext = useStore((s) => s.leaveChatContext);
  const appendNewSessionDraft = useStore((s) => s.appendNewSessionDraft);
  const selectAgent = useStore((s) => s.selectAgent);
  const setMobileScreen = useStore((s) => s.setMobileScreen);

  return useCallback(
    async (prefill: string) => {
      const agent = newestAgent(agents);
      if (!agent) {
        await createDefault.create();
        return;
      }
      leaveChatContext(() => {
        appendNewSessionDraft(agent.id, prefill);
        selectAgent(agent.id);
        setMobileScreen("chat");
      });
    },
    [
      agents,
      createDefault,
      leaveChatContext,
      appendNewSessionDraft,
      selectAgent,
      setMobileScreen,
    ],
  );
}
