import { Close } from "@carbon/icons-react";
import { useState } from "react";

import { Modal, useModalLabelId } from "@/components/modal";
import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUpdateAgent } from "../../agents/api/mutations.js";
import {
  AgentAvatar,
  resolveCharacter,
} from "../../agents/components/avatar/agent-avatar.js";
import { AvatarPicker } from "../../agents/components/avatar/avatar-picker.js";
import { useResolvedAgentDisplay } from "../../agents/hooks/use-resolved-agent-display.js";
import {
  agentSettingsPath,
  type SandboxSection,
} from "../../platform/lib/routes.js";
import { AgentConfiguration } from "./agent-configuration.js";

interface Props {
  agent: AgentView;
  initialSection: SandboxSection;
  onClose: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent's settings in a modal over whatever is
 * on screen, so a person changes a setting without leaving it. It shows all
 * of the Agent's sections, with the restart bar, and keeps the open section
 * to itself, so the address does not change. It is the only place the Agent's settings are shown; there is no
 * page beside it. Opening one of the Agent's sessions from it closes it, and a
 * sign-in started in it comes back to it, on Connections. The chat calls all
 * of it the Agent's settings: its banner shows the Agent's avatar and name, as
 * the design draws it, and is named "<name> settings" for a screen reader.
 */
export function ConfigureAgentModal({ agent, initialSection, onClose }: Props) {
  const [section, setSection] = useState(initialSection);
  const display = useResolvedAgentDisplay(agent);
  const openAgentSession = useStore((s) => s.openAgentSession);

  return (
    <Modal size="xl" heightClass="h-[85vh]" onClose={onClose}>
      <SettingsBanner agent={agent} onClose={onClose} />
      <div
        className="flex min-h-0 flex-1 flex-col"
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
            oauthReturnView={agentSettingsPath(agent.id, "connections")}
          />
        )}
      </div>
    </Modal>
  );
}

/* UNIT_BOUNDARY_DESCRIPTION: the modal's banner, as the design draws it: the Agent's avatar and name on the left, read-only, and the close button on the right; a screen reader hears "<name> settings". */
/* UNIT_BOUNDARY_DESCRIPTION: the banner's avatar is the avatar picker, as the design's chat refresh draws it; the General section keeps its own picker beside the name. */
function BannerAvatar({ agent }: { agent: AgentView }) {
  const change = useUpdateAgent();
  const avatar =
    (change.isPending ? change.variables.avatar : undefined) ?? agent.avatar;
  const current =
    avatar?.startsWith("emoji:") || avatar?.startsWith("image:")
      ? avatar
      : resolveCharacter(agent.name, avatar);
  return (
    <AvatarPicker
      value={current}
      onChange={(next) => change.mutate({ id: agent.id, avatar: next })}
    >
      <AgentAvatar name={agent.name} avatar={avatar} size={28} />
    </AvatarPicker>
  );
}

function SettingsBanner({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  const labelId = useModalLabelId();
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3"
      data-dialog-noautofocus
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <BannerAvatar agent={agent} />
        <h2
          id={labelId}
          aria-label={`${agent.name} settings`}
          className="min-w-0 truncate text-sm font-semibold text-foreground"
        >
          {agent.name}
        </h2>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close"
        tooltip="Close"
        data-dialog-close
        data-testid="configure-agent-modal-close"
        onClick={onClose}
        className="-mr-1 shrink-0 text-muted-foreground"
      >
        <Close size={16} />
      </Button>
    </div>
  );
}
