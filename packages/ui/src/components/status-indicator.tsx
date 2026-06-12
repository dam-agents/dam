import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver.js";

const stateLabel: Record<AgentDisplayState, string> = {
  running: "Running",
  starting: "Starting",
  preparing_workspace: "Preparing workspace",
  hibernating: "Hibernating",
  hibernated: "Hibernating",
  error: "Error",
};

const badgeColors: Record<AgentDisplayState, string> = {
  running: "bg-success-light text-success border-success",
  starting: "bg-warning-light text-warning border-warning",
  preparing_workspace: "bg-warning-light text-warning border-warning",
  hibernating: "bg-info-light text-info/50 border-info/25",
  hibernated: "bg-info-light text-info/50 border-info/25",
  error: "bg-danger-light text-danger border-danger",
};

const dotColors: Record<AgentDisplayState, string> = {
  running: "bg-success",
  starting: "bg-warning anim-pulse",
  preparing_workspace: "bg-warning anim-pulse",
  hibernating: "bg-info/50 anim-pulse",
  hibernated: "bg-info/50",
  error: "bg-danger",
};

/** Shared state pill used in the agents list and the chat header. `sm` matches
 *  the denser chat header treatment; `md` matches the agents-list card.
 *  When both `state` and an override (`label`/`colorClasses`/`dotColorClasses`)
 *  are passed, the overrides win — used for ad-hoc pills like "Busy" that sit
 *  outside the agent-state taxonomy. */
export function StatusBadge({
  state,
  size = "md",
  label,
  colorClasses,
  dotColorClasses,
}: {
  state?: AgentDisplayState;
  size?: "sm" | "md";
  /** Override label + colors for ad-hoc pills (e.g. "Busy" on the chat header).
   *  When provided, `state` is ignored. */
  label?: string;
  colorClasses?: string;
  dotColorClasses?: string;
}) {
  const border = size === "sm" ? "border" : "border-2";
  const dot = size === "sm" ? "w-1.5 h-1.5" : "w-2.5 h-2.5";
  const resolvedLabel = label ?? (state ? stateLabel[state] : "");
  const resolvedColors = colorClasses ?? (state ? badgeColors[state] : "");
  const resolvedDot = dotColorClasses ?? (state ? dotColors[state] : "");
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.03em] ${border} rounded-full px-2.5 py-0.5 ${resolvedColors}`}
    >
      <span
        className={`inline-block ${dot} rounded-full shrink-0 ${resolvedDot}`}
      />
      {resolvedLabel}
    </span>
  );
}
