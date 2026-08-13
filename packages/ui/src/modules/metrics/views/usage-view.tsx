import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { AgentSpendBars } from "../components/agent-spend-bars.js";
import { ModelSpendBars } from "../components/model-spend-bars.js";
import { MonthSwitcher } from "../components/month-switcher.js";
import {
  CHART_HEIGHT_CLASS,
  SpendByDayChart,
} from "../components/spend-by-day-chart.js";
import {
  readFailureMessage,
  UsageNotice,
  UsageStaleLabel,
} from "../components/usage-notice.js";
import { useMonthlySpend } from "../hooks/use-monthly-spend.js";
import { formatUsdCents } from "../lib/format.js";
import { fillMonthDays, monthLabel, monthRange } from "../lib/month-range.js";
import { totalCostUsd } from "../lib/totals.js";

const PAGE_DESCRIPTION = (
  <span className="block max-w-[460px]">
    LLM API spend across all supported agents (currently only Claude Code and
    derivatives).
  </span>
);

/** Settings tab: the user's LLM API spend for one calendar month, totalled
 *  and broken down per model across all their agents. */
export function UsageView() {
  const {
    month,
    setMonth,
    isCurrentMonth,
    label,
    shownMonth,
    data,
    state,
    freshness,
  } = useMonthlySpend();
  const total = totalCostUsd(data?.byModel ?? []);
  const dailyDays = fillMonthDays(
    shownMonth,
    monthRange(shownMonth).isCurrentMonth,
    data?.byDay,
  );

  // A deployment without a telemetry store has no usage to show for any month,
  // so the verdict is rendered once in place of the period control rather than
  // re-derived per month behind a skeleton.
  if (state === "unavailable") {
    return (
      <div>
        <PageHeader title="Usage" description={PAGE_DESCRIPTION} />
        <UsageNotice>{readFailureMessage(true, label)}</UsageNotice>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Usage"
        description={PAGE_DESCRIPTION}
        actions={
          <div className="flex items-center gap-3">
            <UsageStaleLabel freshness={freshness} />
            <MonthSwitcher
              month={month}
              isCurrentMonth={isCurrentMonth}
              onChange={setMonth}
            />
          </div>
        }
      />

      {/* Only when there is nothing to show: a failed refetch keeps the loaded
          month, and the label by the period control names it as not fresh. */}
      {state === "failed" && (
        <UsageNotice>{readFailureMessage(false, label)}</UsageNotice>
      )}
      {state === "loading" && <UsageSkeleton />}
      {state === "ready" && data && (
        <div aria-busy={freshness === "updating"} className="space-y-10">
          <section>
            <SectionLabel spaced>Total spend</SectionLabel>
            <div className="font-mono text-5xl font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {formatUsdCents(total)}
            </div>
          </section>
          {data.byModel.length === 0 ? (
            <section>
              <SectionLabel spaced>Spend by day</SectionLabel>
              <UsageNotice>
                No LLM calls in {monthLabel(shownMonth)}.
              </UsageNotice>
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
