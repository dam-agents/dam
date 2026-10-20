import { useCallback } from "react";

import { useStore } from "../../../store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Opens a follow-up chat of a finished sub-agent:
 * the root driver's blank chat, whose draft names the sub-agent, so the chat
 * shows its prompt and result above the composer and the first send carries
 * them to the agent. The draft holds only the reference; the prompt and result
 * stay with the delegation record.
 */
export function useContinueInNewChat(
  rootDriverId: string,
  invocationId: string,
): () => void {
  const leaveChatContext = useStore((s) => s.leaveChatContext);
  const continueInNewSessionDraft = useStore(
    (s) => s.continueInNewSessionDraft,
  );
  const selectAgent = useStore((s) => s.selectAgent);
  const setMobileScreen = useStore((s) => s.setMobileScreen);

  return useCallback(() => {
    leaveChatContext(() => {
      continueInNewSessionDraft(rootDriverId, invocationId);
      selectAgent(rootDriverId);
      setMobileScreen("chat");
    });
  }, [
    rootDriverId,
    invocationId,
    leaveChatContext,
    continueInNewSessionDraft,
    selectAgent,
    setMobileScreen,
  ]);
}
