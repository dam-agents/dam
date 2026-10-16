import type { ReactNode } from "react";
import { match } from "ts-pattern";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  NEUTRAL_FILL,
  NEUTRAL_LIGHT_FILL,
} from "../../budgets/lib/pool-colors.js";
import { SpendBarTrack } from "../../metrics/components/spend-bar.js";
import {
  COVERED_BY_PLAN,
  NO_COST,
  NO_SPEND_IN_PERIOD,
  NOT_PRICED,
  notPricedHelp,
  paidWithPlanUse,
} from "../lib/copy.js";
import { bareSpend, formatSpend } from "../lib/format.js";
import type { RowAmount, SpendRow } from "../lib/spend-rows.js";

function AmountText({ amount }: { amount: RowAmount }) {
  return match(amount)
    .with({ kind: "paid" }, ({ paidMicros, planMicros }) =>
      planMicros === null
        ? bareSpend(paidMicros, "usd")
        : paidWithPlanUse(paidMicros, planMicros),
    )
    .with({ kind: "plan-only" }, () => COVERED_BY_PLAN)
    .with({ kind: "bobcoin" }, ({ micros }) => formatSpend(micros, "bobcoin"))
    .with({ kind: "no-cost" }, () => NO_COST)
    .with({ kind: "not-priced" }, () => (
      <Tooltip content={notPricedHelp()}>
        <span
          tabIndex={0}
          className="cursor-help underline decoration-dotted underline-offset-2"
        >
          {NOT_PRICED}
        </span>
      </Tooltip>
    ))
    .exhaustive();
}

function SpendRowItem({ row, icon }: { row: SpendRow; icon?: ReactNode }) {
  const hasBar = row.paidPct > 0 || row.planPct > 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 text-foreground">
          {icon}
          <span className="truncate" title={row.label}>
            {row.label}
          </span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
          <AmountText amount={row.amount} />
        </span>
      </div>
      {hasBar && (
        <SpendBarTrack
          pct={row.paidPct}
          extraPct={row.planPct}
          label={`${Math.round(row.paidPct + row.planPct)}% of the largest`}
          className="h-2 rounded-full"
          fillClassName={cn("rounded-full", NEUTRAL_FILL)}
          extraFillClassName={cn("rounded-full", NEUTRAL_LIGHT_FILL)}
        />
      )}
    </div>
  );
}

export function SpendRowList({
  rows,
  iconOf,
}: {
  rows: readonly SpendRow[];
  iconOf?: (key: string) => ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{NO_SPEND_IN_PERIOD}</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <SpendRowItem key={row.key} row={row} icon={iconOf?.(row.key)} />
      ))}
    </div>
  );
}
