import { Badge, type BadgeProps } from "@/components/ui/badge";

import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver.js";

export const stateLabel: Record<AgentDisplayState, string> = {
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
  running:
    "border-[1.5px] border-[#198038] bg-[#defbe6] dark:border-[#42be65] dark:bg-[#022d0d]",
  running_always_on:
    "border-[1.5px] border-[#198038] bg-[#defbe6] dark:border-[#42be65] dark:bg-[#022d0d]",
  starting:
    "border-[1.5px] border-[#198038] bg-[#defbe6] dark:border-[#42be65] dark:bg-[#022d0d]",
  preparing_workspace:
    "border-[1.5px] border-[#198038] bg-[#defbe6] dark:border-[#42be65] dark:bg-[#022d0d]",
  hibernating:
    "border-[1.5px] border-[#697077] bg-[#f2f4f8] dark:border-[#a2a9b0] dark:bg-[#21272a]",
  hibernated:
    "border-[1.5px] border-[#0f62fe] bg-[#edf5ff] dark:border-[#78a9ff] dark:bg-[#001d6c]",
  idle_always_on:
    "border-[1.5px] border-[#0f62fe] bg-[#edf5ff] dark:border-[#78a9ff] dark:bg-[#001d6c]",
  error:
    "border-[1.5px] border-[#da1e28] bg-[#fff1f1] dark:border-[#ff8389] dark:bg-[#520408]",
  over_budget:
    "border-[1.5px] border-[#ba4e00] bg-[#fff2e8] dark:border-[#ff832b] dark:bg-[#3e1a00]",
};

export function StatusBadge({ state }: { state: AgentDisplayState }) {
  return <Badge variant={stateVariant[state]}>{stateLabel[state]}</Badge>;
}
