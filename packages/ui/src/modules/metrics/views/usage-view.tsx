import { useState } from "react";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useSpendBreakdown } from "../api/queries.js";
import { AgentSpendBars } from "../components/agent-spend-bars.js";
import { ModelSpendBars } from "../components/model-spend-bars.js";
import { MonthSwitcher } from "../components/month-switcher.js";
import {
  CHART_HEIGHT_CLASS,
  SpendByDayChart,
} from "../components/spend-by-day-chart.js";
import { useSettledMonth } from "../hooks/use-settled-month.js";
import { formatUsdCents, totalCostUsd } from "../lib/format.js";
import {
  fillMonthDays,
  monthLabel,
  monthRange,
  monthStart,
} from "../lib/month-range.js";
import { isMetricsUnavailable } from "../lib/unavailable.js";

/** Settings tab: the user's LLM API spend for one calendar month, totalled
 *  and broken down per model across all their agents. */
export function UsageView() {
  const [month, setMonth] = useState(() => monthStart(new Date(), 0));
  const { from, to, isCurrentMonth } = monthRange(month);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // One query backs the whole tab, so per-model / per-agent / per-day spend
  // land together under a single loading/error state — the chart never renders
  // an all-zero month while its data is still in flight.
  const { data, isPending, isError, isPlaceholderData, error } =
    useSpendBreakdown(from, to, timeZone);
  const unavailable = isMetricsUnavailable(error);
  const shownMonth = useSettledMonth(
    month,
    !isPlaceholderData && data !== undefined,
  );
  const total = totalCostUsd(data?.byModel ?? []);
  const dailyDays = fillMonthDays(
    shownMonth,
    monthRange(shownMonth).isCurrentMonth,
    data?.byDay,
  );

  return (
    <div>
      <PageHeader
        title="Usage"
        description={
          <span className="block max-w-[460px]">
            LLM API spend across all supported agents (currently only Claude
            Code and derivatives).
          </span>
        }
        actions={
          unavailable ? undefined : (
            <MonthSwitcher
              month={month}
              isCurrentMonth={isCurrentMonth}
              onChange={setMonth}
            />
          )
        }
      />

      {/* Only when there is nothing to show: a failed refetch keeps the loaded
          month, and a transient failure isn't a verdict on the deployment. */}
      {isError && !data && (
        <Card
          className={`flex ${CHART_HEIGHT_CLASS} items-center justify-center p-5`}
        >
          <p className="text-sm text-muted-foreground">
            {unavailable
              ? "Usage metrics are unavailable on this deployment."
              : "Couldn't load usage right now."}
          </p>
        </Card>
      )}
      {isPending && !isError && <UsageSkeleton />}
      {data && (
        <div
          className={cn(
            "space-y-10 transition-opacity",
            (isPlaceholderData || isError) && "opacity-40",
          )}
        >
          <section>
            <SectionLabel spaced>Total spend</SectionLabel>
            <div className="font-mono text-5xl font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {formatUsdCents(total)}
            </div>
          </section>
          {data.byModel.length === 0 ? (
            <section>
              <SectionLabel spaced>Spend by day</SectionLabel>
              <Card
                className={`flex ${CHART_HEIGHT_CLASS} items-center justify-center p-5`}
              >
                <p className="text-sm text-muted-foreground">
                  No LLM calls in {monthLabel(shownMonth)}.
                </p>
              </Card>
            </section>
          ) : (
            <>
              <section>
                <SectionLabel spaced>Spend by day</SectionLabel>
                <Card className="p-5">
                  <SpendByDayChart days={dailyDays} />
                </Card>
              </section>
              <section>
                <SectionLabel spaced>Spend by model</SectionLabel>
                <Card className="p-5">
                  <ModelSpendBars rows={data.byModel} />
                </Card>
              </section>
            </>
          )}
          {data.byAgent.length > 0 && (
            <section>
              <SectionLabel spaced>Spend by agent</SectionLabel>
              <Card className="p-5">
                <AgentSpendBars rows={data.byAgent} />
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** Placeholder shell shown while the month's spend loads, shaped at the final
 *  section heights so the layout doesn't jump when data lands. */
function UsageSkeleton() {
  return (
    <div className="space-y-10">
      <section>
        <SectionLabel spaced>Total spend</SectionLabel>
        <div className="h-12 w-40 animate-pulse rounded bg-muted" />
      </section>
      <section>
        <SectionLabel spaced>Spend by day</SectionLabel>
        <Card className={`${CHART_HEIGHT_CLASS} animate-pulse p-5`} />
      </section>
      <section>
        <SectionLabel spaced>Spend by model</SectionLabel>
        <BarsSkeleton />
      </section>
      <section>
        <SectionLabel spaced>Spend by agent</SectionLabel>
        <BarsSkeleton />
      </section>
    </div>
  );
}

/** Matches a `SpendBar` stack: four rows at the bar's own height, inside the
 *  same padded card. */
function BarsSkeleton() {
  return (
    <Card className="flex flex-col gap-4 p-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-muted" />
      ))}
    </Card>
  );
}
