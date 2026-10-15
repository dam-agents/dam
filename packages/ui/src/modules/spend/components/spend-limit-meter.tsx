import type { SpendLimitState, SpendUnit } from "api-server-api";

import { cn } from "@/lib/utils";

import { SpendBarTrack } from "../../metrics/components/spend-bar.js";
import { formatSpend, formatSpendOf } from "../lib/format.js";
import { LIMIT_STATE_FILL, LIMIT_STATE_TEXT } from "../lib/state-colors.js";

interface Props {
  label: string;
  showLabel?: boolean;
  unit: SpendUnit;
  spentMicros: number;
  limitMicros: number;
  state: SpendLimitState;
  extensions?: number;
}

function continuedNote(extensions: number): string | null {
  if (extensions === 0) return null;
  return extensions === 1
    ? "continued once today"
    : `continued ${String(extensions)} times today`;
}

export function SpendLimitMeter({
  label,
  showLabel = false,
  unit,
  spentMicros,
  limitMicros,
  state,
  extensions = 0,
}: Props) {
  const pct =
    limitMicros > 0 ? Math.min(100, (spentMicros / limitMicros) * 100) : 100;
  const left = Math.max(0, limitMicros - spentMicros);
  const note = continuedNote(extensions);

  return (
    <div className="flex flex-col gap-1.5">
      {showLabel && <p className="text-sm text-muted-foreground">{label}</p>}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className={cn("font-mono tabular-nums", LIMIT_STATE_TEXT[state])}>
          {formatSpendOf(spentMicros, limitMicros, unit)} today
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {[`${formatSpend(left, unit)} left`, note]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <SpendBarTrack
        pct={pct}
        fillClassName={LIMIT_STATE_FILL[state]}
        label={`${label}: ${String(Math.round(pct))}% used`}
      />
    </div>
  );
}
