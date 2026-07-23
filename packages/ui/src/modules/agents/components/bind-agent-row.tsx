import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";

interface Props {
  agent: AgentView;
  /** Emphasize the row (e.g. an agent just created on this page). */
  highlighted: boolean;
  disabled: boolean;
  /** This row's bind is in flight — shows a "Connecting …" label. */
  pending: boolean;
  onPick: () => void;
}

/** A pick-to-connect row in the Slack/Telegram bind pickers. */
export function BindAgentRow({
  agent,
  highlighted,
  disabled,
  pending,
  onPick,
}: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border bg-background px-4 py-3 text-left hover:border-foreground/40 disabled:opacity-60",
        highlighted ? "border-foreground" : "border-border",
      )}
    >
      <span className="text-[14px] font-semibold text-foreground">
        {pending ? `Connecting ${agent.name}…` : agent.name}
      </span>
      {agent.description && (
        <span className="text-[12px] text-muted-foreground">
          {agent.description}
        </span>
      )}
      {agent.templateId && (
        <span className="text-[11px] font-mono text-muted-foreground">
          {agent.templateId}
        </span>
      )}
    </button>
  );
}
