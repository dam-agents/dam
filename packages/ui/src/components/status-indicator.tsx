import { Power } from "@carbon/icons-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver.js";

const stateLabel: Record<AgentDisplayState, string> = {
  running: "Running",
  starting: "Starting",
  preparing_workspace: "Preparing workspace",
  hibernating: "Hibernating",
  hibernated: "Hibernating",
  error: "Error",
  over_budget: "Over budget",
};

const stateVariant: Record<
  AgentDisplayState,
  NonNullable<BadgeProps["variant"]>
> = {
  running: "success",
  starting: "warning",
  preparing_workspace: "warning",
  hibernating: "muted",
  hibernated: "muted",
  error: "danger",
  over_budget: "warning",
};

export const stateDotClass: Record<AgentDisplayState, string> = {
  running: "bg-success",
  starting: "bg-warning",
  preparing_workspace: "bg-warning",
  hibernating: "bg-muted-foreground",
  hibernated: "bg-muted-foreground",
  error: "bg-danger",
  over_budget: "bg-warning",
};

export function StatusBadge({
  state,
  working,
  alwaysOn,
}: {
  state: AgentDisplayState;
  working?: boolean;
  alwaysOn?: boolean;
}) {
  const splitRunning = state === "running" && working !== undefined;
  const label = splitRunning
    ? working
      ? "Working"
      : "Idle"
    : stateLabel[state];
  const variant = splitRunning && !working ? "accent" : stateVariant[state];
  const badge = (
    <Badge variant={variant} className="gap-1">
      {alwaysOn && <Power size={12} aria-hidden />}
      {label}
    </Badge>
  );
  if (!alwaysOn) return badge;
  return (
    <Tooltip content="Always on. This agent never hibernates on its own and keeps its compute reserved.">
      <span className="inline-flex" aria-label={`${label}, always on`}>
        {badge}
      </span>
    </Tooltip>
  );
}
