import { type ReactNode, useCallback, useState } from "react";

import type { AgentView } from "../../../types.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { ConfigureAgentModal } from "../../sandboxes/components/configure-agent-modal.js";

interface OpenSettings {
  agentId: string;
  section: SandboxSection;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The chat's way to open the Agent's settings over
 * the conversation, at a chosen section. The modal belongs to the Agent it
 * was opened for, so switching the chat to another Agent drops it.
 */
export function useAgentSettingsModal(agent: AgentView | null): {
  openSettings: (section: SandboxSection) => void;
  settingsModal: ReactNode;
} {
  const [open, setOpen] = useState<OpenSettings | null>(null);
  const agentId = agent?.id ?? null;
  const openSettings = useCallback(
    (section: SandboxSection) => {
      if (agentId) setOpen({ agentId, section });
    },
    [agentId],
  );
  const settingsModal =
    open && agent && open.agentId === agent.id ? (
      <ConfigureAgentModal
        key={agent.id}
        agent={agent}
        initialSection={open.section}
        onClose={() => setOpen(null)}
      />
    ) : null;
  return { openSettings, settingsModal };
}
