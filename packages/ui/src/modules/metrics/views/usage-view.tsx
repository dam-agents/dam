import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import type { SpendByDay } from "api-server-api";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { formatDate } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { useSpendBreakdown } from "../api/queries.js";
import { AgentSpendBars } from "../components/agent-spend-bars.js";
import { ModelSpendTable } from "../components/model-spend-table.js";
import {
  CHART_HEIGHT_CLASS,
  SpendByDayChart,
} from "../components/spend-by-day-chart.js";
import { formatUsdCents } from "../lib/format.js";

// Month boundaries are computed in the browser's timezone; the API takes the
// resulting instants, so "calendar month" means the user's wall-clock month.
const monthStart = (base: Date, offset: number) =>
  new Date(base.getFullYear(), base.getMonth() + offset, 1);

const PAGE_DESCRIPTION = (
  <span className="block max-w-[460px]">
    LLM API spend across all supported agents (currently only Claude Code and
    derivatives).
  </span>
);

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

// Which month the rows on screen actually describe. While a month switch is in
// flight the previous month's figures are still displayed, so the chart has to
// be zero-filled against *their* calendar — remapping them onto the newly
// selected month would draw a flat, empty chart the data never claimed.
function monthOfRows(rows: SpendByDay[] | undefined, fallback: Date): Date {
  const [year, month] = rows?.[0]?.day.split("-").map(Number) ?? [];
  return year && month ? new Date(year, month - 1, 1) : fallback;
}

/** Settings tab: the user's LLM API spend for one calendar month, totalled
 *  and broken down per model across all their agents. */
export function UsageView() {
  const [month, setMonth] = useState(() => monthStart(new Date(), 0));
  const currentMonth = monthStart(new Date(), 0);
  const isCurrentMonth = month >= currentMonth;
  const monthLabel = formatDate(month, {
    month: "long",
    year: "numeric",
  });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const from = month.toISOString();
  const to = monthStart(month, 1).toISOString();
  // One query backs the whole tab, so per-model / per-agent / per-day spend
  // land together under a single loading/error state — the chart never renders
  // an all-zero month while its data is still in flight.
  const { data, isPending, isError, isPlaceholderData, isUnavailable } =
    useSpendBreakdown(from, to, timeZone);

  // A deployment without a telemetry store has no usage to show for any month,
  // so the verdict is rendered once in place of the period control rather than
  // re-derived per month behind a skeleton.
  if (isUnavailable) {
    return (
      <div>
        <PageHeader title="Usage" description={PAGE_DESCRIPTION} />
        <NoticeCard>
          Usage metrics are unavailable on this deployment.
        </NoticeCard>
      </div>
    );
  }

  const total = data?.byModel.reduce((sum, row) => sum + row.costUsd, 0) ?? 0;
  const dataMonth = monthOfRows(data?.byDay, month);
  const dailyDays = fillMonthDays(
    dataMonth,
    dataMonth >= currentMonth,
    data?.byDay,
  );

  return (
    <div>
      <PageHeader
        title="Usage"
        description={PAGE_DESCRIPTION}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => setMonth(monthStart(month, -1))}
            >
              <ChevronLeft size={16} className="text-muted-foreground" />
            </Button>
            <span className="min-w-[120px] text-center text-sm font-medium">
              {monthLabel}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next month"
              disabled={isCurrentMonth}
              onClick={() => setMonth(monthStart(month, 1))}
            >
              <ChevronRight size={16} className="text-muted-foreground" />
            </Button>
          </div>
        }
      />

      {isError && (
        <NoticeCard>Couldn't load usage for {monthLabel}.</NoticeCard>
      )}
      {isPending && !isError && <UsageSkeleton />}
      {data && (
        // `isPlaceholderData` means these are the previously viewed month's
        // figures, held on screen while the selected month loads; dim them so
        // the numbers don't read as final.
        <div
          aria-busy={isPlaceholderData}
          className={cn(
            "space-y-10 transition-opacity",
            isPlaceholderData && "opacity-60",
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
              <NoticeCard>No LLM calls in {monthLabel}.</NoticeCard>
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

/** One-line message at the day chart's height, so standing in for a chart —
 *  or for the whole page — doesn't collapse the layout. */
function NoticeCard({ children }: { children: ReactNode }) {
  return (
    <Card
      className={`flex ${CHART_HEIGHT_CLASS} items-center justify-center p-5`}
    >
      <p className="text-sm text-muted-foreground">{children}</p>
    </Card>
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
