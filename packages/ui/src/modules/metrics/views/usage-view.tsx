import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { OwnSpendLimitCard } from "../../spend/components/own-spend-limit-card.js";
import { SpendWidget } from "../../spend/components/spend-widget.js";
import { AgentSpendBars } from "../components/agent-spend-bars.js";
import { ModelSpendBars } from "../components/model-spend-bars.js";
import { MonthSwitcher } from "../components/month-switcher.js";
import { ProviderSpendBars } from "../components/provider-spend-bars.js";
import { SessionTypeSpendBars } from "../components/session-type-spend-bars.js";
import {
  CHART_HEIGHT_CLASS,
  SpendByDayChart,
} from "../components/spend-by-day-chart.js";
import { UncountedCallsNote } from "../components/uncounted-calls-note.js";
import {
  HarnessReportsLead,
  readFailureMessage,
  UsageStaleLabel,
} from "../components/usage-notice.js";
import { useMonthlySpend } from "../hooks/use-monthly-spend.js";
import { formatUsdCents } from "../lib/format.js";
import { fillMonthDays, monthLabel, monthRange } from "../lib/month-range.js";
import { totalCostUsd } from "../lib/totals.js";

const PAGE_DESCRIPTION = (
  <span className="block max-w-[460px]">
    Set spend limits and see what your agents spend on models.
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
  const total = totalCostUsd(data?.byModel ?? []);
  const dailyDays = fillMonthDays(
    shownMonth,
    monthRange(shownMonth).isCurrentMonth,
    data?.byDay,
  );

  if (state === "unavailable") {
    return (
      <div>
        <PageHeader title="Usage" description={PAGE_DESCRIPTION} />
        <MeasuredSpend />
        <OwnSpendLimitCard />
        <HarnessReportsLead />
        <EmptyState>{readFailureMessage(true, label)}</EmptyState>
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
      <MeasuredSpend />
      <OwnSpendLimitCard />
      <HarnessReportsLead />

      {}
      {state === "failed" && (
        <EmptyState>{readFailureMessage(false, label)}</EmptyState>
      )}
      {state === "loading" && <UsageSkeleton />}
      {state === "ready" && data && (
        <div aria-busy={freshness === "updating"} className="space-y-10">
          <section>
            <SectionLabel spaced>Total spend</SectionLabel>
            <div className="font-mono text-5xl font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {formatUsdCents(total)}
            </div>
            <UncountedCallsNote rows={data.byModel} />
          </section>
          {data.byModel.length === 0 ? (
            <section>
              <SectionLabel spaced>Spend by day</SectionLabel>
              <EmptyState>No LLM calls in {monthLabel(shownMonth)}.</EmptyState>
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
              {data.byProvider.length > 0 && (
                <section>
                  <SectionLabel spaced>Spend by provider</SectionLabel>
                  <Card className="p-5">
                    <ProviderSpendBars rows={data.byProvider} />
                  </Card>
                </section>
              )}
            </>
          )}
          {data.bySessionType.length > 0 && (
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

function MeasuredSpend() {
  return (
    <div className="mb-10">
      <SpendWidget showOwnLimit={false} />
    </div>
  );
}

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
        <SectionLabel spaced>Spend by session type</SectionLabel>
        <BarsSkeleton />
      </section>
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
