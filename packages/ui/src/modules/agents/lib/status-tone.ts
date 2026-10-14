import type { AgentDisplayState } from "../utils/agent-resolver.js";

// UNIT_BOUNDARY_DESCRIPTION: the text colours of the state word on an agent row, from the resource card's muted palette and dark enough for 4.5:1 on the row in both themes: green for an agent at work, blue for one up and idle, red for one that failed or cannot start. A paused or starting agent keeps the line's own colour, and a refused vm agent the warning colour it already had.
export const STATUS_TONE = {
  working:
    "text-emerald-700 dark:text-[color-mix(in_srgb,var(--color-emerald-500)_70%,var(--color-stone-300))]",
  idle: "text-[color-mix(in_srgb,var(--color-blue-600)_60%,var(--color-stone-600))] dark:text-[color-mix(in_srgb,var(--color-blue-400)_55%,var(--color-stone-300))]",
  failed:
    "text-[color-mix(in_srgb,var(--color-red-600)_35%,var(--color-stone-500))] dark:text-[color-mix(in_srgb,var(--color-red-400)_65%,var(--color-stone-300))]",
  waiting: "text-warning-fg dark:text-warning-fg",
} as const;

export function statusTone(
  state: AgentDisplayState,
  working: boolean | undefined,
  keptWork: number,
): string {
  if (state === "error") return STATUS_TONE.failed;
  if (state === "over_budget") return STATUS_TONE.waiting;
  if (state === "running") {
    return working === false && keptWork === 0
      ? STATUS_TONE.idle
      : STATUS_TONE.working;
  }
  return "";
}
