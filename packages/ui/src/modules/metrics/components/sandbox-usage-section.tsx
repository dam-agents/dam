import type { TokenSpendByModel } from "api-server-api";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useSpendBreakdown } from "../api/queries.js";
import { useSettledMonth } from "../hooks/use-settled-month.js";
import { totalCostUsd } from "../lib/format.js";
import {
  fillMonthDays,
  monthLabel,
  monthRange,
  monthStart,
} from "../lib/month-range.js";
import { isMetricsUnavailable } from "../lib/unavailable.js";
import { ModelSpendBars } from "./model-spend-bars.js";
import { MonthSwitcher } from "./month-switcher.js";
import { CHART_HEIGHT_CLASS, SpendByDayChart } from "./spend-by-day-chart.js";
import { SpendStatCards } from "./spend-stat-cards.js";

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

function Notice({ children }: { children: string }) {
  return (
    <Card
      className={`flex ${CHART_HEIGHT_CLASS} items-center justify-center p-5`}
    >
      <p className="text-sm text-muted-foreground">{children}</p>
    </Card>
  );
}

/** Sandbox-home "Usage" section: this sandbox's LLM spend for one calendar
 *  month, headline figures above the same per-model bars and per-day chart the
 *  global Usage tab shows. */
export function SandboxUsageSection({ agentId }: { agentId: string }) {
  const [month, setMonth] = useState(() => monthStart(new Date(), 0));
  const { from, to, isCurrentMonth } = monthRange(month);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data, isPending, isError, isPlaceholderData, error } =
    useSpendBreakdown(from, to, timeZone, agentId);
  const unavailable = isMetricsUnavailable(error);
  const shownMonth = useSettledMonth(
    month,
    !isPlaceholderData && data !== undefined,
  );
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
        <Notice>
          {unavailable
            ? "Usage metrics are unavailable on this deployment."
            : "Couldn't load usage right now."}
        </Notice>
      )}
      {isPending && !isError && <UsageSkeleton />}
      {data && (
        <div
          className={cn(
            "space-y-6 transition-opacity",
            (isPlaceholderData || isError) && "opacity-40",
          )}
        >
          <SpendStatCards {...sums} />
          {data.byModel.length === 0 ? (
            <Notice>{`No LLM calls in ${monthLabel(shownMonth)}.`}</Notice>
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
