import { useState } from "react";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { useSpendBreakdown } from "../api/queries.js";
import { AgentSpendBars } from "../components/agent-spend-bars.js";
import { ModelSpendTable } from "../components/model-spend-table.js";
import { MonthSwitcher } from "../components/month-switcher.js";
import {
  CHART_HEIGHT_CLASS,
  SpendByDayChart,
} from "../components/spend-by-day-chart.js";
import { formatUsdCents } from "../lib/format.js";
import {
  fillMonthDays,
  monthLabel,
  monthRange,
  monthStart,
} from "../lib/month-range.js";

/** Settings tab: the user's LLM API spend for one calendar month, totalled
 *  and broken down per model across all their agents. */
export function UsageView() {
  const [month, setMonth] = useState(() => monthStart(new Date(), 0));
  const { from, to, isCurrentMonth } = monthRange(month);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // One query backs the whole tab, so per-model / per-agent / per-day spend
  // land together under a single loading/error state — the chart never renders
  // an all-zero month while its data is still in flight.
  const { data, isPending, isError } = useSpendBreakdown(from, to, timeZone);
  const total = data?.byModel.reduce((sum, row) => sum + row.costUsd, 0) ?? 0;
  const dailyDays = fillMonthDays(month, isCurrentMonth, data?.byDay);

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
          <MonthSwitcher
            month={month}
            isCurrentMonth={isCurrentMonth}
            onChange={setMonth}
          />
        }
      />

      {isError && (
        <Card
          className={`flex ${CHART_HEIGHT_CLASS} items-center justify-center p-5`}
        >
          <p className="text-sm text-muted-foreground">
            Usage metrics are unavailable on this deployment.
          </p>
        </Card>
      )}
      {isPending && !isError && <UsageSkeleton />}
      {data && (
        <div className="space-y-10">
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
                  No LLM calls in {monthLabel(month)}.
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
                <Card className="p-0">
                  <ModelSpendTable rows={data.byModel} />
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
        <Card className="animate-pulse p-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[50px] border-b border-border-hairline last:border-b-0"
            />
          ))}
        </Card>
      </section>
      <section>
        <SectionLabel spaced>Spend by agent</SectionLabel>
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </section>
    </div>
  );
}
