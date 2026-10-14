import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

import { badgeLabel } from "../modules/agents/lib/state-label.js";
import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver.js";

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

export function StatusBadge({
  state,
  working,
  keptWork = 0,
  vm,
  refused,
  className,
}: {
  state: AgentDisplayState;
  working?: boolean;
  vm: boolean;
  refused: boolean;
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
    : badgeLabel(state, vm, refused);
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
      content="This agent never sleeps on its own, so it keeps using its share of resources."
    >
      <span className="inline-flex" tabIndex={0}>
        <Badge variant="muted" data-testid="always-on-tag">
          Always on
        </Badge>
      </span>
    </Tooltip>
  );
}
