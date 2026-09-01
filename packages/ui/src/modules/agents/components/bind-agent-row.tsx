import { Badge } from "@/components/ui/badge";
import { CardButton } from "@/components/ui/card-button";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { agentKindBadge } from "../utils/agent-kind.js";

interface Props {
  agent: AgentView;
  highlighted: boolean;
  disabled: boolean;
  pending: boolean;
  onPick: () => void;
}

export function BindAgentRow({
  agent,
  highlighted,
  disabled,
  pending,
  onPick,
}: Props) {
  const kindBadge = agentKindBadge(agent);

  return (
    <CardButton
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex flex-col items-start gap-0.5 px-4 py-3",
        highlighted && "border-foreground",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">
          {pending ? `Connecting ${agent.name}…` : agent.name}
        </span>
        {kindBadge && (
          <Badge variant={kindBadge.variant} className="shrink-0">
            {kindBadge.label}
          </Badge>
        )}
      </span>
      {agent.description && (
        <span className="text-xs text-muted-foreground">
          {agent.description}
        </span>
      )}
    </CardButton>
  );
}
