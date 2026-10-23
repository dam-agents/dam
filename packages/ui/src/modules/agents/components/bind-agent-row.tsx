import { CardButton } from "@/components/ui/card-button";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";

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
  return (
    <CardButton
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex flex-col items-start gap-0.5 px-4 py-3",
        highlighted && "border-foreground",
      )}
    >
      <span className="text-sm font-semibold text-foreground">
        {pending ? `Connecting ${agent.name}…` : agent.name}
      </span>
      {agent.description && (
        <span className="text-xs text-muted-foreground">
          {agent.description}
        </span>
      )}
      {agent.templateId && (
        <span className="text-[11px] font-mono text-muted-foreground">
          {agent.templateId}
        </span>
      )}
    </CardButton>
  );
}
