import { useCallback, useEffect } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import type { SandboxSection } from "../../platform/lib/routes.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The chat's way to open the Agent's settings over
 * the conversation, at a chosen section, through the app's one settings modal.
 * The modal belongs to the Agent it was opened for, so a chat that comes to
 * show another Agent closes it — by a switch in the chat, or by Back, Forward
 * or Home and then another Agent's chat. Only that closes it: a wrench
 * elsewhere, such as a sidebar row's, may open the modal for another Agent
 * over a chat that stays where it is.
 */
export function useAgentSettingsModal(agent: AgentView | null): {
  openSettings: (section: SandboxSection) => void;
} {
  const agentId = agent?.id ?? null;
  const open = useStore((s) => s.openAgentSettings);
  const close = useStore((s) => s.closeAgentSettings);
  const openSettings = useCallback(
    (section: SandboxSection) => {
      if (agentId) open(agentId, section);
    },
    [agentId, open],
  );
  /* UNIT_BOUNDARY_DESCRIPTION: each time the chat comes to show an Agent, including when it first mounts, the modal's own Agent is compared with it; a chat still loading its Agent compares nothing. */
  useEffect(() => {
    if (!agentId) return;
    const owner = useStore.getState().agentSettings?.agentId;
    if (owner && owner !== agentId) close();
  }, [agentId, close]);
  return { openSettings };
}
