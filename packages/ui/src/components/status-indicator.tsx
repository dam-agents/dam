import { Badge, type BadgeProps } from "@/components/ui/badge";

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

/** Dot color per state — keep aligned with `stateVariant`. */
export const stateDotClass: Record<AgentDisplayState, string> = {
  running: "bg-success",
  starting: "bg-warning",
  preparing_workspace: "bg-warning",
  hibernating: "bg-muted-foreground",
  hibernated: "bg-muted-foreground",
  error: "bg-danger",
  over_budget: "bg-warning",
};

export function StatusBadge({ state }: { state: AgentDisplayState }) {
  return <Badge variant={stateVariant[state]}>{stateLabel[state]}</Badge>;
}
