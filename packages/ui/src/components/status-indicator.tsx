import { Badge, type BadgeProps } from "@/components/ui/badge";

import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver";

const stateLabel: Record<AgentDisplayState, string> = {
  running: "Running",
  starting: "Starting",
  preparing_workspace: "Preparing workspace",
  hibernating: "Hibernating",
  hibernated: "Hibernating",
  error: "Error",
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
};

export function StatusBadge({
  state,
  label,
  colorClasses,
}: {
  state?: AgentDisplayState;
  size?: "sm" | "md";
  label?: string;
  colorClasses?: string;
  dotColorClasses?: string;
}) {
  const resolvedLabel = label ?? (state ? stateLabel[state] : "");
  if (colorClasses) {
    return (
      <Badge variant="outline" className={colorClasses}>
        {resolvedLabel}
      </Badge>
    );
  }
  return (
    <Badge variant={state ? stateVariant[state] : "outline"}>
      {resolvedLabel}
    </Badge>
  );
}
