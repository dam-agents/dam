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
  migrating: "Migrating",
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
  migrating: "warning",
};

export const stateDotClass: Record<AgentDisplayState, string> = {
  running: "bg-success",
  starting: "bg-warning",
  preparing_workspace: "bg-warning",
  hibernating: "bg-muted-foreground",
  hibernated: "bg-muted-foreground",
  error: "bg-danger",
  over_budget: "bg-warning",
  migrating: "bg-warning",
};

export function StatusBadge({
  state,
  working,
  keptWork = 0,
}: {
  state: AgentDisplayState;
  working?: boolean;
  keptWork?: number;
}) {
  const splitRunning = state === "running" && working !== undefined;
  if (splitRunning && !working && keptWork > 0) {
    return <BackgroundWorkBadge count={keptWork} />;
  }
  const label = splitRunning
    ? working
      ? "Working"
      : "Idle"
    : stateLabel[state];
  const variant = splitRunning && !working ? "accent" : stateVariant[state];
  return <Badge variant={variant}>{label}</Badge>;
}

function BackgroundWorkBadge({ count }: { count: number }) {
  const hint =
    count === 1
      ? "1 background process keeps this agent awake."
      : `${count} background processes keep this agent awake.`;
  return (
    <Tooltip side="top" content={hint}>
      <span className="inline-flex" tabIndex={0} aria-label={hint}>
        <Badge variant="success" data-testid="background-work-badge">
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
