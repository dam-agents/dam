import type { SpendLimitState } from "api-server-api";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  LIMIT_STATE_FILL,
  LIMIT_STATE_SHARE,
  LIMIT_STATE_TRACK,
} from "../lib/state-colors.js";

export interface BarPart {
  micros: number;
  label: string;
}

interface Props {
  state: SpendLimitState;
  limitMicros: number;
  mine: BarPart;
  others?: BarPart;
  left: BarPart;
  label: string;
  muted?: boolean;
}

const PART =
  "h-full shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function widthOf(micros: number, limitMicros: number): string {
  if (limitMicros <= 0) return micros > 0 ? "100%" : "0%";
  return `${String(Math.min(100, (micros / limitMicros) * 100))}%`;
}

export function SharedLimitBar({
  state,
  limitMicros,
  mine,
  others,
  left,
  label,
  muted = false,
}: Props) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex w-full overflow-hidden",
        muted ? "h-1.5 gap-px rounded-xs" : "h-3 gap-0.5 rounded-sm",
        LIMIT_STATE_TRACK[state],
      )}
    >
      {mine.micros > 0 && (
        <Part
          part={mine}
          width={widthOf(mine.micros, limitMicros)}
          fill={
            muted && state === "ok"
              ? LIMIT_STATE_SHARE.ok
              : LIMIT_STATE_FILL[state]
          }
        />
      )}
      {others && others.micros > 0 && (
        <Part
          part={others}
          width={widthOf(others.micros, limitMicros)}
          fill={LIMIT_STATE_SHARE[state]}
        />
      )}
      {left.micros > 0 && (
        <Tooltip content={left.label}>
          <span
            role="img"
            tabIndex={0}
            aria-label={left.label}
            className={cn(PART, "flex-1")}
          />
        </Tooltip>
      )}
    </div>
  );
}

function Part({
  part,
  width,
  fill,
}: {
  part: BarPart;
  width: string;
  fill: string;
}) {
  return (
    <Tooltip content={part.label}>
      <span
        role="img"
        tabIndex={0}
        aria-label={part.label}
        className={cn(PART, fill)}
        style={{ width }}
      />
    </Tooltip>
  );
}
