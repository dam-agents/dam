import type { SpendLimitState } from "api-server-api";

import { cn } from "@/lib/utils";

import { SpendBarTrack } from "../../metrics/components/spend-bar.js";
import {
  LIMIT_STATE_FILL,
  LIMIT_STATE_PERCENT,
  LIMIT_STATE_TRACK,
} from "../lib/state-colors.js";

interface Props {
  pct: number;
  state: SpendLimitState;
  label: string;
  size?: "md" | "sm";
}

const SIZE = {
  md: "h-3 rounded-sm",
  sm: "h-1 rounded-full",
} as const;

export function LimitBar({ pct, state, label, size = "md" }: Props) {
  return (
    <div className="flex items-center gap-2.5">
      <SpendBarTrack
        pct={pct}
        label={label}
        className="flex-1"
        trackClassName={cn(SIZE[size], LIMIT_STATE_TRACK[state])}
        fillClassName={LIMIT_STATE_FILL[state]}
      />
      <span
        className={cn(
          "min-w-9 text-right text-xs tabular-nums",
          LIMIT_STATE_PERCENT[state],
        )}
      >
        {`${String(Math.round(pct))}%`}
      </span>
    </div>
  );
}
