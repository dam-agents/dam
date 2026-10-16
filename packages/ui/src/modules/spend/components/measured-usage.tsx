import { Card } from "@/components/ui/card";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

import { CHART_HEIGHT_CLASS } from "../../metrics/components/spend-by-day-chart.js";
import { useSpendBreakdown, useSpendMetering } from "../api/queries.js";
import { useShowPlanUse } from "../hooks/use-spend-preferences.js";
import { estimatedCallsNote, SPEND_LOAD_ERROR } from "../lib/copy.js";
import { rangeOf, type SpendPeriod } from "../lib/spend-period.js";
import { utcDayOf } from "../lib/utc-day.js";
import { MeasuredBreakdownCards } from "./measured-breakdown-cards.js";
import { MeasuredSpendCard } from "./measured-spend-card.js";
import { MeasuredStatCards } from "./measured-stat-cards.js";
import { PeriodPicker } from "./period-picker.js";
import { PlanUseCheckbox } from "./plan-use-checkbox.js";

const REFRESH_MS = 30_000;

interface Props {
  agentId?: string;
  period: SpendPeriod;
  onPeriodChange: (period: SpendPeriod) => void;
}

export function MeasuredUsage({ agentId, period, onPeriodChange }: Props) {
  const today = utcDayOf(useNow(REFRESH_MS));
  const range = rangeOf(period, today);
  const { data: metering, isError: meteringFailed } = useSpendMetering();
  const query = useSpendBreakdown(agentId ? { agentId, ...range } : range);
  const showPlanUse = useShowPlanUse();
  const breakdown = query.data;
  const estimatedCalls =
    breakdown?.totals.reduce((sum, row) => sum + row.estimatedCalls, 0) ?? 0;

  if (query.isError || meteringFailed) {
    return <p className="text-sm text-muted-foreground">{SPEND_LOAD_ERROR}</p>;
  }
  if (!metering || !breakdown) return <MeasuredUsageSkeleton />;

  return (
    <div className="flex flex-col gap-4" aria-busy={query.isFetching}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker
          period={period}
          onPeriodChange={onPeriodChange}
          startDay={metering.startDay}
          today={today}
        />
        <PlanUseCheckbox />
      </div>
      <MeasuredSpendCard
        range={range}
        today={today}
        metering={metering}
        breakdown={breakdown}
        showPlanUse={showPlanUse}
      />
      <MeasuredStatCards
        totals={breakdown.totals}
        modelTimeMs={breakdown.modelTimeMs}
      />
      {estimatedCalls > 0 && (
        <p className="text-sm text-muted-foreground">
          {estimatedCallsNote(estimatedCalls)}
        </p>
      )}
      <MeasuredBreakdownCards
        {...(agentId !== undefined && { agentId })}
        breakdown={breakdown}
        showPlanUse={showPlanUse}
      />
    </div>
  );
}

function MeasuredUsageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <Card className={cn(CHART_HEIGHT_CLASS, "animate-pulse")} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="h-40 animate-pulse" />
        <Card className="h-40 animate-pulse" />
      </div>
    </div>
  );
}
