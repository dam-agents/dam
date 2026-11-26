import type { SpendLimitView, SpendUnit } from "api-server-api";
import type { ReactNode } from "react";

import {
  continuedToday,
  limitMeterLabel,
  limitStateText,
  percentOfLimit,
  spentWithoutLimit,
} from "../lib/copy.js";
import { localResetTime } from "../lib/format.js";
import { LimitBar } from "./limit-bar.js";
import { LimitAmounts } from "./limit-row.js";

interface Props {
  spentMicros: number;
  limit: SpendLimitView | undefined;
  resetsAt: string;
  subject: string;
  icon: ReactNode;
  unit?: SpendUnit;
}

export function DailyLimitMeter({
  spentMicros,
  limit,
  resetsAt,
  subject,
  icon,
  unit = "usd",
}: Props) {
  if (!limit) {
    return (
      <p className="text-sm text-foreground tabular-nums">
        {spentWithoutLimit(spentMicros, unit)}
      </p>
    );
  }
  const pct = percentOfLimit(limit.spentMicros, limit.effectiveMicros);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
        >
          {icon}
        </span>
        <LimitBar
          pct={pct}
          label={limitMeterLabel(subject, pct)}
          percent={false}
          className="min-w-0 flex-1"
        />
        <LimitAmounts
          spentMicros={limit.spentMicros}
          amountMicros={limit.effectiveMicros}
          unit={unit}
        />
      </div>
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

  return <p className="text-sm text-muted-foreground">{text}</p>;
}
