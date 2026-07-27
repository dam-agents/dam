import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import type { SpendByDay } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import {
  useAgentSpend,
  useDailySpend,
  useModelSpend,
} from "../api/queries.js";
import {
  AgentSpendBars,
  ModelSpendTable,
  SpendByDayChart,
} from "../components/metrics-panel.js";
import { formatUsd } from "../lib/format.js";

// Month boundaries are computed in the browser's timezone; the API takes the
// resulting instants, so "calendar month" means the user's wall-clock month.
const monthStart = (base: Date, offset: number) =>
  new Date(base.getFullYear(), base.getMonth() + offset, 1);

// The browser owns calendar semantics: from the sparse per-day rows the server
// returns, build the full day list for the selected month, zero-filling days
// with no spend. For the current month we stop at today so there are no empty
// future columns. Keys are local `YYYY-MM-DD`, matching the server's buckets.
const pad = (n: number) => String(n).padStart(2, "0");
function fillMonthDays(
  month: Date,
  isCurrentMonth: boolean,
  rows: SpendByDay[] | undefined,
): SpendByDay[] {
  const byDay = new Map((rows ?? []).map((r) => [r.day, r.costUsd]));
  const year = month.getFullYear();
  const m = month.getMonth();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const lastDay = isCurrentMonth ? new Date().getDate() : daysInMonth;
  const days: SpendByDay[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const day = `${year}-${pad(m + 1)}-${pad(d)}`;
    days.push({ day, costUsd: byDay.get(day) ?? 0 });
  }
  return days;
}

/** Settings tab: the user's LLM API spend for one calendar month, totalled
 *  and broken down per model across all their agents. */
export function UsageView() {
  const [month, setMonth] = useState(() => monthStart(new Date(), 0));
  const isCurrentMonth = month >= monthStart(new Date(), 0);
  const monthLabel = month.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const from = month.toISOString();
  const to = monthStart(month, 1).toISOString();
  const { data, isPending, isError } = useModelSpend(from, to);
  const { data: agentData } = useAgentSpend(from, to);
  const { data: dailyData } = useDailySpend(from, to, timeZone);
  const total = data?.reduce((sum, row) => sum + row.costUsd, 0) ?? 0;
  const dailyDays = fillMonthDays(month, isCurrentMonth, dailyData);

  return (
    <div>
      <PageHeader
        title="Usage"
        description="LLM API spend across all supported agents (currently only Claude Code and derivatives)."
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => setMonth(monthStart(month, -1))}
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="min-w-[120px] text-center text-[14px] font-medium">
              {monthLabel}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next month"
              disabled={isCurrentMonth}
              onClick={() => setMonth(monthStart(month, 1))}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      />

      {isError && (
        <p className="text-[14px] text-muted-foreground">
          Usage metrics are unavailable on this deployment.
        </p>
      )}
      {isPending && !isError && (
        <p className="text-[14px] text-muted-foreground">Loading usage…</p>
      )}
      {data && (
        <div className="space-y-10">
          <section>
            <SectionLabel spaced>Total spend</SectionLabel>
            <div className="text-[40px] font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {formatUsd(total)}
            </div>
          </section>
          {data.length === 0 ? (
            <section>
              <SectionLabel spaced>Spend by model</SectionLabel>
              <p className="text-[14px] text-muted-foreground">
                No LLM calls in {monthLabel}.
              </p>
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
                <Card className="p-4 text-[12px]">
                  <ModelSpendTable rows={data} />
                </Card>
              </section>
            </>
          )}
          {agentData && agentData.length > 0 && (
            <section>
              <SectionLabel spaced>Spend by agent</SectionLabel>
              <Card className="p-5">
                <AgentSpendBars rows={agentData} />
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
