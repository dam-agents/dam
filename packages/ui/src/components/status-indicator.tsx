import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver.js";

const stateLabel: Record<AgentDisplayState, string> = {
  running: "Running",
  starting: "Starting",
  hibernating: "Hibernating",
  hibernated: "Hibernated",
  error: "Error",
  restarting: "Restarting",
  "no-instance": "No instance",
};

const badgeClasses: Record<AgentDisplayState, string> = {
  running: "bg-success-light text-success border-success",
  starting: "bg-warning-light text-warning border-warning",
  hibernating: "bg-warning-light text-warning border-warning",
  hibernated: "bg-info-light text-info/70 border-info/30",
  error: "bg-destructive/10 text-destructive border-destructive",
  restarting: "bg-warning-light text-warning border-warning",
  "no-instance": "bg-muted text-muted-foreground border-border",
};

const dotClasses: Record<AgentDisplayState, string> = {
  running: "bg-success",
  starting: "bg-warning animate-pulse",
  hibernating: "bg-warning animate-pulse",
  hibernated: "bg-info/60",
  error: "bg-destructive",
  restarting: "bg-warning animate-pulse",
  "no-instance": "bg-muted-foreground",
};

/**
 * Shared state pill used in the agents list and the chat header.
 */
export function StatusBadge({
  state,
  size = "md",
  label,
  colorClasses,
  dotColorClasses,
  className,
}: {
  state?: AgentDisplayState;
  size?: "sm" | "md";
  label?: string;
  colorClasses?: string;
  dotColorClasses?: string;
  className?: string;
}) {
  const dot = size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2";
  const resolvedLabel = label ?? (state ? stateLabel[state] : "");
  const resolvedColors = colorClasses ?? (state ? badgeClasses[state] : "");
  const resolvedDot = dotColorClasses ?? (state ? dotClasses[state] : "");
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-semibold uppercase tracking-wide",
        size === "sm" ? "text-[10px] px-2 py-0" : "text-[11px] px-2.5 py-0.5",
        resolvedColors,
        className,
      )}
    >
      <span className={cn("inline-block rounded-full shrink-0", dot, resolvedDot)} />
      {resolvedLabel}
    </Badge>
  );
}
