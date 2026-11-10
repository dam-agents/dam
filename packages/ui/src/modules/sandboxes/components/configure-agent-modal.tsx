import { useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useResolvedAgentDisplay } from "../../agents/hooks/use-resolved-agent-display.js";
import { routeToPath, type SandboxSection } from "../../platform/lib/routes.js";
import { AgentConfiguration } from "./agent-configuration.js";

interface Props {
  agent: AgentView;
  initialSection: SandboxSection;
  onClose: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent's configuration in a modal over its
 * chat, so a person changes a setting without leaving the conversation. It
 * shows the same sections as the configuration page, with the same restart
 * bar, and keeps the open section to itself, so the chat's address does not
 * change. Opening one of the Agent's sessions from it closes it.
 */
export function ConfigureAgentModal({ agent, initialSection, onClose }: Props) {
  const [section, setSection] = useState(initialSection);
  const display = useResolvedAgentDisplay(agent);
  const openAgentSession = useStore((s) => s.openAgentSession);

  return (
    <Modal size="xl" heightClass="h-[85vh]" onClose={onClose}>
      <DialogHeader
        title={`Configure ${agent.name}`}
        truncateTitle
        onClose={onClose}
        closeTestId="configure-agent-modal-close"
        className="md:py-4"
      />
      <div
        className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 md:px-6"
        data-testid="configure-agent-modal"
      >
        {display && (
          <AgentConfiguration
            agent={agent}
            display={display}
            section={section}
            onNavigate={setSection}
            onOpenSession={(sessionId) => {
              onClose();
              openAgentSession(agent.id, sessionId);
            }}
            oauthReturnView={routeToPath({ view: "chat", agent: agent.id })}
          />
        )}
      </div>
    </Modal>
  );
}
