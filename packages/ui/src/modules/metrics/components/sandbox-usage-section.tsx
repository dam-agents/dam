import type { TokenSpendByModel } from "api-server-api";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useMonthlySpend } from "../hooks/use-monthly-spend.js";
import { totalCostUsd } from "../lib/format.js";
import { fillMonthDays, monthLabel, monthRange } from "../lib/month-range.js";
import { ModelSpendBars } from "./model-spend-bars.js";
import { MonthSwitcher } from "./month-switcher.js";
import { CHART_HEIGHT_CLASS, SpendByDayChart } from "./spend-by-day-chart.js";
import { SpendStatCards } from "./spend-stat-cards.js";
import { readFailureMessage, UsageNotice } from "./usage-notice.js";

// Cache reads dominate agent traffic, so folding them into "in" is what makes
// the figure reflect what actually entered the context — the same sum the
// per-model bars' caption shows.
function totals(rows: TokenSpendByModel[]) {
  return {
    costUsd: totalCostUsd(rows),
    ...rows.reduce(
      (acc, row) => ({
        calls: acc.calls + row.calls,
        tokensIn:
          acc.tokensIn +
          row.inputTokens +
          row.cacheReadTokens +
          row.cacheCreationTokens,
        tokensOut: acc.tokensOut + row.outputTokens,
        durationMs: acc.durationMs + row.durationMs,
      }),
      { calls: 0, tokensIn: 0, tokensOut: 0, durationMs: 0 },
    ),
  };
}

/** Sandbox-home "Usage" section: this sandbox's LLM spend for one calendar
 *  month, headline figures above the same per-model bars and per-day chart the
 *  global Usage tab shows. */
export function SandboxUsageSection({ agentId }: { agentId: string }) {
  const {
    month,
    setMonth,
    isCurrentMonth,
    shownMonth,
    data,
    isPending,
    isError,
    isStale,
    unavailable,
  } = useMonthlySpend(agentId);
  const sums = totals(data?.byModel ?? []);

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-4">
        <SectionLabel>Usage</SectionLabel>
        {!unavailable && (
          <MonthSwitcher
            month={month}
            isCurrentMonth={isCurrentMonth}
            onChange={setMonth}
          />
        )}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        LLM spend for this sandbox, including work it delegated to other agents.
      </p>

      {/* Only when there is nothing to show: a failed refetch keeps the loaded
          month, and a transient failure isn't a verdict on the deployment. */}
      {isError && !data && (
        <UsageNotice>{readFailureMessage(unavailable)}</UsageNotice>
      )}
      {isPending && !isError && <UsageSkeleton />}
      {data && (
        <div
          className={cn(
            "space-y-6 transition-opacity",
            isStale && "opacity-40",
          )}
        >
          <SpendStatCards {...sums} />
          {data.byModel.length === 0 ? (
            <UsageNotice>{`No LLM calls in ${monthLabel(shownMonth)}.`}</UsageNotice>
          ) : (
            <>
              <section>
                <SectionLabel spaced>Spend by model</SectionLabel>
                <Card className="p-5">
                  <ModelSpendBars rows={data.byModel} />
                </Card>
              </section>
              <section>
                <SectionLabel spaced>Spend by day</SectionLabel>
                <Card className="p-5">
                  <SpendByDayChart
                    days={fillMonthDays(
                      shownMonth,
                      monthRange(shownMonth).isCurrentMonth,
                      data.byDay,
                    )}
                  />
                </Card>
              </section>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Shaped at the final section heights so the layout doesn't jump. */
function UsageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="h-[76px] animate-pulse" />
        ))}
      </div>
      <Card className={`${CHART_HEIGHT_CLASS} animate-pulse p-5`} />
    </div>
  );
}
