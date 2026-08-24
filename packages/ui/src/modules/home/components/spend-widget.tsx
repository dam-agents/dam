import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { useSpendBreakdown } from "../../metrics/api/queries.js";
import { totalCostUsd } from "../../metrics/lib/totals.js";
import {
  SPEND_PERIODS,
  type SpendPeriod,
  spendRange,
} from "../lib/spend-period.js";
import { WidgetSkeleton } from "./home-skeletons.js";

const TOP_SPENDERS = 3;
const ROUNDS_TO_A_VISIBLE_CENT_USD = 0.005;

export function SpendWidget() {
  const [period, setPeriod] = useState<SpendPeriod>("1m");
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const { from, to } = useMemo(() => spendRange(period, new Date()), [period]);
  const { data, isUnavailable, isPending } = useSpendBreakdown(
    from,
    to,
    timeZone,
  );

  if (isUnavailable) return null;
  if (isPending) return <WidgetSkeleton rows={3} />;

  const total = data ? totalCostUsd(data.byModel) : 0;
  const spenders = (data?.byAgent ?? [])
    .filter((row) => row.costUsd >= ROUNDS_TO_A_VISIBLE_CENT_USD)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, TOP_SPENDERS);
  const top = spenders[0]?.costUsd ?? 0;

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-6">
      <div className="mb-1 flex min-h-[32px] items-center justify-between">
        <p className="text-sm text-muted-foreground">Spend</p>
        <div className="flex shrink-0 gap-0.5 rounded-md border border-border/50 bg-muted/40 p-0.5">
          {SPEND_PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPeriod(option)}
              aria-pressed={option === period}
              className={cn(
                "rounded-md px-1.5 py-1 text-sm transition-colors",
                option === period
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-5 text-[28px] leading-none font-bold tracking-tight text-foreground tabular-nums">
        ${total.toFixed(2)}
      </p>

      {spenders.length > 0 ? (
        <div className="space-y-3">
          {spenders.map((spender) => (
            <div key={spender.agentId}>
              <div className="mb-1 flex items-center justify-between">
                <span className="truncate text-sm text-muted-foreground">
                  {spender.agentName}
                </span>
                <span className="ml-2 shrink-0 text-sm text-muted-foreground tabular-nums">
                  ${spender.costUsd.toFixed(2)}
                </span>
              </div>
              <div
                className="h-3 rounded-full bg-accent"
                style={{
                  width: top > 0 ? `${(spender.costUsd / top) * 100}%` : "0%",
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No spend in this period.
        </p>
      )}
    </div>
  );
}
