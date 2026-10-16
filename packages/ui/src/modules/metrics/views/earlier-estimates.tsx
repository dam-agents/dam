import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import {
  EARLIER_ESTIMATES_HEADING,
  earlierEstimatesText,
} from "../../spend/lib/copy.js";
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
  readFailureMessage,
  UsageNotice,
  UsageStaleLabel,
} from "../components/usage-notice.js";
import { useMonthlySpend } from "../hooks/use-monthly-spend.js";
import { formatUsdCents } from "../lib/format.js";
import { fillMonthDays, monthLabel, monthRange } from "../lib/month-range.js";
import { totalCostUsd } from "../lib/totals.js";

export function EarlierEstimates({ closesOn }: { closesOn: string }) {
  const monthly = useMonthlySpend();
  const { month, setMonth, isCurrentMonth, state, freshness } = monthly;

  return (
    <Callout
      variant="dashed"
      aria-label={EARLIER_ESTIMATES_HEADING}
      className="mb-10 p-5"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[560px]">
          <h2 className="text-base font-medium text-foreground">
            {EARLIER_ESTIMATES_HEADING}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {earlierEstimatesText(closesOn)}
          </p>
        </div>
        {state !== "unavailable" && (
          <div className="flex items-center gap-3">
            <UsageStaleLabel freshness={freshness} />
            <MonthSwitcher
              month={month}
              isCurrentMonth={isCurrentMonth}
              onChange={setMonth}
            />
          </div>
        )}
      </div>
      <EarlierEstimatesBody {...monthly} />
    </Callout>
  );
}

function EarlierEstimatesBody({
  label,
  shownMonth,
  data,
  state,
  freshness,
}: ReturnType<typeof useMonthlySpend>) {
  if (state === "unavailable" || state === "failed") {
    return (
      <UsageNotice>
        {readFailureMessage(state === "unavailable", label)}
      </UsageNotice>
    );
  }
  if (state === "loading" || !data) return <UsageSkeleton />;
  const total = totalCostUsd(data.byModel);
  const dailyDays = fillMonthDays(
    shownMonth,
    monthRange(shownMonth).isCurrentMonth,
    data.byDay,
  );

  return (
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
          <UsageNotice>No LLM calls in {monthLabel(shownMonth)}.</UsageNotice>
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
    </div>
  );
}
