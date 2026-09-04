import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { useFeatures } from "../../features/api/queries.js";
import { AgentSpendBars } from "../components/agent-spend-bars.js";
import { ModelSpendBars } from "../components/model-spend-bars.js";
import { MonthSwitcher } from "../components/month-switcher.js";
import { SessionTypeSpendBars } from "../components/session-type-spend-bars.js";
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
import {
  creditUnitLabel,
  formatAxisCount,
  formatAxisUsd,
  formatCredits,
  formatUsd,
  formatUsdCents,
} from "../lib/format.js";
import { fillMonthDays, monthLabel, monthRange } from "../lib/month-range.js";
import { daySeries, totalCostUsd, totalCredits } from "../lib/totals.js";

const PAGE_DESCRIPTION = (
  <span className="block max-w-[460px]">
    LLM API spend across all supported agents. Harnesses billed in credits
    rather than dollars are reported in their own unit, never converted.
  </span>
);

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
  const { data: features } = useFeatures();
  const showSessionTypes = features?.["session-costs"] ?? false;
  const total = totalCostUsd(data?.byModel ?? []);
  const credits = totalCredits(data?.byModel ?? []);
  const dailyDays = fillMonthDays(
    shownMonth,
    monthRange(shownMonth).isCurrentMonth,
    data?.byDay,
  );

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

      {}
      {state === "failed" && (
        <UsageNotice>{readFailureMessage(false, label)}</UsageNotice>
      )}
      {state === "loading" && (
        <UsageSkeleton showSessionTypes={showSessionTypes} />
      )}
      {state === "ready" && data && (
        <div aria-busy={freshness === "updating"} className="space-y-10">
          <section>
            <SectionLabel spaced>Total spend</SectionLabel>
            <div className="font-mono text-5xl font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {formatUsdCents(total)}
            </div>
            {credits.length > 0 && (
              <div className="mt-2 font-mono text-xl font-semibold tabular-nums text-muted-foreground">
                + {formatCredits(credits)}
              </div>
            )}
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
                  <SpendByDayChart
                    days={daySeries(dailyDays, null)}
                    formatValue={formatUsd}
                    formatAxis={formatAxisUsd}
                  />
                </Card>
              </section>
              {credits.map((credit) => (
                <section key={credit.unit}>
                  <SectionLabel spaced>
                    {creditUnitLabel(credit.unit)} by day
                  </SectionLabel>
                  <Card className="p-5">
                    <SpendByDayChart
                      days={daySeries(dailyDays, credit.unit)}
                      formatValue={(v) =>
                        formatCredits([{ unit: credit.unit, amount: v }])
                      }
                      formatAxis={formatAxisCount}
                    />
                  </Card>
                </section>
              ))}
              <section>
                <SectionLabel spaced>Spend by model</SectionLabel>
                <Card className="p-5">
                  <ModelSpendBars rows={data.byModel} />
                </Card>
              </section>
            </>
          )}
          {showSessionTypes && data.bySessionType.length > 0 && (
            <section>
              <SectionLabel spaced>Spend by session type</SectionLabel>
              <Card className="p-5">
                <SessionTypeSpendBars rows={data.bySessionType} />
              </Card>
            </section>
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

function UsageSkeleton({ showSessionTypes }: { showSessionTypes: boolean }) {
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
      {showSessionTypes && (
        <section>
          <SectionLabel spaced>Spend by session type</SectionLabel>
          <BarsSkeleton />
        </section>
      )}
      <section>
        <SectionLabel spaced>Spend by agent</SectionLabel>
        <BarsSkeleton />
      </section>
    </div>
  );
}

function BarsSkeleton() {
  return (
    <Card className="flex flex-col gap-4 p-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-muted" />
      ))}
    </Card>
  );
}
