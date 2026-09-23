import { Badge } from "@/components/ui/badge";
import { CardButton } from "@/components/ui/card-button";

import { StatusBadge } from "../../../../components/status-indicator.js";
import type { AgentView } from "../../../../types.js";
import { formatCpuMemory, sizeInMi } from "../../../budgets/lib/slots.js";
import { AgentChannelChips } from "../../../sandboxes/components/channels/agent-channel-chips.js";
import { resolveAgentDisplay } from "../../utils/agent-resolver.js";
import { AgentAvatar, isAsleep } from "../avatar/agent-avatar.js";
import { ContributionFailuresBadge } from "../contribution-failures-badge.js";

const NO_IDS: ReadonlySet<string> = new Set();

interface Props {
  agent: AgentView;
  selected: boolean;
  activeSchedules: number;
  onSelect: () => void;
}

export function AgentPickerCard({
  agent,
  selected,
  activeSchedules,
  onSelect,
}: Props) {
  const { size, name, hibernationTimeoutMin, contributionFailures } = agent;
  const display = resolveAgentDisplay(agent, NO_IDS);
  const sizeLabel =
    size.cpu && size.memory ? formatCpuMemory(sizeInMi(size)) : null;

  return (
    <CardButton
      selected={selected}
      onClick={onSelect}
      className="flex w-full items-start justify-between gap-4 p-5"
    >
      <AgentAvatar name={name} size={40} sleeping={isAsleep(display.state)} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="truncate text-base font-semibold text-foreground">
            {name}
          </span>
          <ContributionFailuresBadge failures={contributionFailures} />
        </span>
        {sizeLabel && (
          <span className="mt-1 block text-sm text-muted-foreground">
            {sizeLabel}
          </span>
        )}
        <AgentChannelChips agent={agent} className="mt-3">
          {activeSchedules > 0 && (
            <Badge variant="muted">
              {activeSchedules} active schedule
              {activeSchedules === 1 ? "" : "s"}
            </Badge>
          )}
        </AgentChannelChips>
      </span>
      <StatusBadge
        state={display.state}
        alwaysOn={hibernationTimeoutMin === 0}
      />
    </CardButton>
  );
}
