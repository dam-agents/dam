import type { SpendBreakdown, SpendMetering } from "api-server-api";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import { API_SPEND_TITLE, SPEND_BY_DAY } from "../lib/copy.js";
import { microsToUsd } from "../lib/format.js";
import { unitTotals } from "../lib/measured-spend.js";
import { measuredRange } from "../lib/range-label.js";
import type { DayRange } from "../lib/utc-day.js";
import { AnimatedUsd } from "./animated-usd.js";
import { MeasuredDayChart } from "./measured-day-chart.js";
import { SpendRangeLine, SpendSideLines } from "./spend-total-lines.js";

interface Props {
  range: DayRange;
  today: string;
  metering: SpendMetering;
  breakdown: SpendBreakdown;
  showPlanUse: boolean;
}

export function MeasuredSpendCard({
  range,
  today,
  metering,
  breakdown,
  showPlanUse,
}: Props) {
  const totals = unitTotals(breakdown.totals);
  const measured = measuredRange(range, metering.startDay) !== null;
  return (
    <Card className="p-6">
      <p className="text-sm text-muted-foreground">{API_SPEND_TITLE}</p>
      <p className="text-3xl font-semibold tabular-nums text-foreground">
        {measured ? <AnimatedUsd value={microsToUsd(totals.usd)} /> : "—"}
      </p>
      <div className="mt-1 flex flex-col gap-1">
        <SpendRangeLine range={range} startDay={metering.startDay} />
        {measured && (
          <SpendSideLines totals={totals} showPlanUse={showPlanUse} />
        )}
      </div>
      <SectionLabel spaced className="mt-6">
        {SPEND_BY_DAY}
      </SectionLabel>
      <MeasuredDayChart
        range={range}
        byDay={breakdown.byDay}
        startDay={metering.startDay}
        today={today}
        showPlanUse={showPlanUse}
      />
    </Card>
  );
}
