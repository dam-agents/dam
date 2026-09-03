import { Power } from "@carbon/icons-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";

import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver.js";

const ALWAYS_ON_STATES = new Set<AgentDisplayState>([
  "running_always_on",
  "idle_always_on",
]);

const stateLabel: Record<AgentDisplayState, string> = {
  running: "Working",
  running_always_on: "Working",
  starting: "Working",
  preparing_workspace: "Working",
  hibernating: "Hibernating",
  hibernated: "Idle",
  idle_always_on: "Idle",
  error: "Error",
  over_budget: "Over budget",
};

const stateVariant: Record<
  AgentDisplayState,
  NonNullable<BadgeProps["variant"]>
> = {
  running: "success",
  running_always_on: "success",
  starting: "success",
  preparing_workspace: "success",
  hibernating: "muted",
  hibernated: "info",
  idle_always_on: "info",
  error: "danger",
  over_budget: "warning",
};

export const stateDotClass: Record<AgentDisplayState, string> = {
  running: "bg-success",
  running_always_on: "bg-success",
  starting: "bg-success",
  preparing_workspace: "bg-success",
  hibernating: "bg-muted-foreground",
  hibernated: "bg-info",
  idle_always_on: "bg-info",
  error: "bg-danger",
  over_budget: "bg-warning",
};

export function StatusBadge({ state }: { state: AgentDisplayState }) {
  return (
    <Badge variant={stateVariant[state]} className="gap-1">
      {ALWAYS_ON_STATES.has(state) && <Power size={16} />}
      {stateLabel[state]}
    </Badge>
  );
}
