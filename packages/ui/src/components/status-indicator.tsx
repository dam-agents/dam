import { Power } from "@carbon/icons-react";
import { useState } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  TooltipContent,
  TooltipRoot,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const [open, setOpen] = useState(false);
  if (!alwaysOn) {
    return <Badge variant={variant}>{label}</Badge>;
  }
  return (
    <TooltipRoot open={open} onOpenChange={setOpen}>
      <span
        className="inline-flex"
        aria-label={`${label}, always on`}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
      >
        <Badge variant={variant} className="gap-1">
          <TooltipTrigger asChild>
            <span className="flex">
              <Power size={12} aria-hidden />
            </span>
          </TooltipTrigger>
          {label}
        </Badge>
      </span>
      <TooltipContent
        tail
        side="top"
        className="max-w-xs text-xs leading-relaxed"
      >
        Always on. This agent never hibernates on its own and keeps its compute
        reserved.
      </TooltipContent>
    </TooltipRoot>
  );
}
