import type { SpendLimitView, SpendUnit } from "api-server-api";

import { cn } from "@/lib/utils";

import { SpendBarTrack } from "../../metrics/components/spend-bar.js";
import {
  continuedToday,
  limitMeterLabel,
  limitStateText,
  spentOfLimit,
  spentWithoutLimit,
} from "../lib/copy.js";
import { localResetTime } from "../lib/format.js";
import { LIMIT_STATE_FILL, LIMIT_STATE_TEXT } from "../lib/state-colors.js";

interface Props {
  spentMicros: number;
  limit: SpendLimitView | undefined;
  resetsAt: string;
  subject: string;
  unit?: SpendUnit;
}

export function DailyLimitMeter({
  spentMicros,
  limit,
  resetsAt,
  subject,
  unit = "usd",
}: Props) {
  if (!limit) {
    return (
      <p className="text-sm text-foreground tabular-nums">
        {spentWithoutLimit(spentMicros, unit)}
      </p>
    );
  }
  const pct =
    limit.effectiveMicros > 0
      ? Math.min(100, (limit.spentMicros / limit.effectiveMicros) * 100)
      : 100;
  const continued = limit.extensions > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-foreground tabular-nums">
        {spentOfLimit(
          limit.spentMicros,
          limit.amountMicros,
          continued || limit.leftMicros === 0 ? null : limit.leftMicros,
          unit,
        )}
      </p>
      <SpendBarTrack
        pct={pct}
        fillClassName={LIMIT_STATE_FILL[limit.state]}
        label={limitMeterLabel(subject, pct)}
      />
      <LimitStateLine limit={limit} resetsAt={resetsAt} />
    </div>
  );
}

function LimitStateLine({
  limit,
  resetsAt,
}: {
  limit: SpendLimitView;
  resetsAt: string;
}) {
  const text = [
    limitStateText(limit.state, localResetTime(resetsAt)),
    limit.extensions > 0 ? continuedToday(limit.extensions) : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (!text) return null;

  return (
    <p
      className={cn(
        "text-sm",
        limit.state === "ok"
          ? "text-muted-foreground"
          : LIMIT_STATE_TEXT[limit.state],
      )}
    >
      {text}
    </p>
  );
}
