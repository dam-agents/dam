import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver.js";

const stateLabel: Record<AgentDisplayState, string> = {
  running: "Running",
  starting: "Starting",
  preparing_workspace: "Preparing workspace",
  hibernating: "Pausing",
  hibernated: "Paused",
  error: "Error",
  over_budget: "Over budget",
  migrating: "Migrating",
};

const stateVariant: Record<
  AgentDisplayState,
  NonNullable<BadgeProps["variant"]>
> = {
  running: "success",
  starting: "info",
  preparing_workspace: "info",
  hibernating: "muted",
  hibernated: "muted",
  error: "danger",
  over_budget: "warning",
  migrating: "info",
};

export const stateDotClass: Record<AgentDisplayState, string> = {
  running: "bg-success",
  starting: "bg-info",
  preparing_workspace: "bg-info",
  hibernating: "bg-muted-foreground",
  hibernated: "bg-muted-foreground",
  error: "bg-danger",
  over_budget: "bg-warning",
  migrating: "bg-info",
};

// UNIT_BOUNDARY_DESCRIPTION: the state badge's word. A refused vm agent waits for its owner's memory, which is no budget of theirs.
export function badgeLabel(state: AgentDisplayState, vm?: boolean): string {
  return vm && state === "over_budget"
    ? "Waiting for memory"
    : stateLabel[state];
}

export function StatusBadge({
  state,
  working,
  keptWork = 0,
  vm,
  className,
}: {
  state: AgentDisplayState;
  working?: boolean;
  vm?: boolean;
  keptWork?: number;
  className?: string;
}) {
  const splitRunning = state === "running" && working !== undefined;
  if (splitRunning && !working && keptWork > 0) {
    return <BackgroundWorkBadge count={keptWork} className={className} />;
  }
  const label = splitRunning
    ? working
      ? "Working"
      : "Idle"
    : badgeLabel(state, vm);
  const variant = splitRunning && !working ? "accent" : stateVariant[state];
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}

function BackgroundWorkBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  const hint =
    count === 1
      ? "1 background process keeps this agent awake."
      : `${count} background processes keep this agent awake.`;
  return (
    <Tooltip side="top" content={hint}>
      <span className="inline-flex" tabIndex={0} aria-label={hint}>
        <Badge
          variant="success"
          className={className}
          data-testid="background-work-badge"
        >
          Background work
        </Badge>
      </span>
    </Tooltip>
  );
}

export function AlwaysOnTag() {
  return (
    <Tooltip
      side="top"
      content="This agent never hibernates on its own and keeps its compute reserved."
    >
      <span className="inline-flex" tabIndex={0}>
        <Badge variant="muted" data-testid="always-on-tag">
          Always on
        </Badge>
      </span>
    </Tooltip>
  );
}
