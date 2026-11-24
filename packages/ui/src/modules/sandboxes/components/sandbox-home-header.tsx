import type { ReactNode } from "react";

import type { AgentView } from "../../../types.js";
import { EditableAgentIdentity } from "../../agents/components/editable-agent-identity.js";
import { GatewayFailureBadge } from "../../agents/components/gateway-failure-badge.js";
import { SharedBadge } from "../../agents/components/shared-badge.js";
import { UpdateAvailableAction } from "../../agents/components/update-available-action.js";
import { useUpdateSandbox } from "../../agents/hooks/use-update-sandbox.js";
import { isSharedAgent, ownerLine } from "../../agents/lib/agent-editors.js";

interface Props {
  agent: AgentView;
}

export function SandboxIdentity({ agent }: Props) {
  return (
    <div className="mb-4 flex flex-col gap-2 px-3">
      <div className="flex min-w-0 items-center gap-3">
        <EditableAgentIdentity
          agent={agent}
          avatarSize={36}
          nameClassName="text-lg font-semibold text-foreground"
          nameTag="h2"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        {isSharedAgent(agent) && <SharedBadge />}
        <GatewayFailureBadge agent={agent} />
      </div>
      {agent.access.role === "editor" && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="agent-owner-line"
        >
          {ownerLine(agent.access.ownerEmail)}
        </p>
      )}
    </div>
  );
}

export type SectionHeaderSlot = (actions?: ReactNode) => ReactNode;

export function SandboxHomeHeader({
  agent,
  title,
  description,
  actions,
  showUpdate = true,
}: {
  agent: AgentView;
  title: string;
  description?: string;
  actions?: ReactNode;
  showUpdate?: boolean;
}) {
  const { updateOne, updatingId } = useUpdateSandbox();
  /* UNIT_BOUNDARY_DESCRIPTION: the open section's heading, at the design's size for the settings modal: an 18 px semibold title, its actions on the right, and its description under it. */
  return (
    <header className="mb-5 flex flex-col gap-1">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {showUpdate && (
            <UpdateAvailableAction
              agent={agent}
              pending={updatingId === agent.id}
              busy={updatingId !== null}
              onUpdate={() => void updateOne(agent)}
            />
          )}
          {actions}
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </header>
  );
}
