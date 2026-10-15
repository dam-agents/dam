import type { PoolLevel } from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: the muted fill every Home meter shares for a figure that carries no warning, so the spend bars and the resource bars read as one design.
export const NEUTRAL_FILL = "bg-slate-500 dark:bg-slate-400";

const LEVEL_FILL: Record<PoolLevel, string> = {
  ok: NEUTRAL_FILL,
  warning:
    "bg-[color-mix(in_srgb,var(--color-amber-600)_40%,var(--color-stone-500))] dark:bg-[color-mix(in_srgb,var(--color-amber-500)_40%,var(--color-stone-500))]",
  critical:
    "bg-[color-mix(in_srgb,var(--color-red-600)_35%,var(--color-stone-500))] dark:bg-red-400/60",
};

const REST_FILL: Record<PoolLevel, string> = {
  ok: "bg-slate-300 dark:bg-slate-600",
  warning:
    "bg-[color-mix(in_srgb,color-mix(in_srgb,var(--color-amber-600)_40%,var(--color-stone-500))_45%,var(--color-slate-200))] dark:bg-[color-mix(in_srgb,color-mix(in_srgb,var(--color-amber-500)_40%,var(--color-stone-500))_45%,var(--color-slate-700))]",
  critical:
    "bg-[color-mix(in_srgb,color-mix(in_srgb,var(--color-red-600)_35%,var(--color-stone-500))_45%,var(--color-slate-200))] dark:bg-red-400/30",
};

export const LEVEL_ICON: Record<PoolLevel, string> = {
  ok: "",
  warning:
    "text-[color-mix(in_srgb,var(--color-amber-600)_40%,var(--color-stone-500))] dark:text-[color-mix(in_srgb,var(--color-amber-500)_40%,var(--color-stone-500))]",
  critical:
    "text-[color-mix(in_srgb,var(--color-red-600)_35%,var(--color-stone-500))] dark:text-red-400",
};

// UNIT_BOUNDARY_DESCRIPTION: an agent's own share takes the level's colour and everything else on the bar a lighter tint of it, so a bar whose use is mostly caches and system still shows its level.
export function segmentFill(level: PoolLevel, filled: boolean): string {
  return filled ? LEVEL_FILL[level] : REST_FILL[level];
}
