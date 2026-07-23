import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import type { SpendByAgent, SpendByDay } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import {
  useModelSpend,
  useSpendByAgent,
  useSpendByDay,
} from "../api/queries.js";
import { ModelSpendTable } from "../components/metrics-panel.js";
import { formatUsd } from "../lib/format.js";

// Month boundaries are computed in the browser's timezone; the API takes the
// resulting instants, so "calendar month" means the user's wall-clock month.
const monthStart = (base: Date, offset: number) =>
  new Date(base.getFullYear(), base.getMonth() + offset, 1);

// The IANA zone the browser is in — passed to the API so day buckets are cut
// on the same wall-clock midnights the client renders the calendar in.
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayKey = (year: number, month0: number, day: number) =>
  `${year}-${pad2(month0 + 1)}-${pad2(day)}`;

// The server response is sparse (only days with Spend). The client owns the
// calendar: emit every day of the selected month, zero-filling the gaps, and
// for the current month stop at today so there are no empty future columns.
function fillMonthDays(
  month: Date,
  isCurrentMonth: boolean,
  rows: readonly SpendByDay[] | undefined,
): SpendByDay[] {
  const spendByDay = new Map((rows ?? []).map((r) => [r.day, r.costUsd]));
  const year = month.getFullYear();
  const month0 = month.getMonth();
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const lastDay = isCurrentMonth ? new Date().getDate() : daysInMonth;
  const out: SpendByDay[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const key = dayKey(year, month0, day);
    out.push({ day: key, costUsd: spendByDay.get(key) ?? 0 });
  }
  return out;
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
  const from = month.toISOString();
  const to = monthStart(month, 1).toISOString();
  const { data, isPending, isError } = useModelSpend(from, to);
  const byAgent = useSpendByAgent(from, to);
  const byDay = useSpendByDay(from, to, timeZone);
  const total = data?.reduce((sum, row) => sum + row.costUsd, 0) ?? 0;
  const dailySpend = fillMonthDays(month, isCurrentMonth, byDay.data);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="mb-1 text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">
            Usage
          </h2>
          <p className="text-[14px] text-foreground/80 mb-6">
            LLM API spend across all supported agents (currently only Claude
            Code and derivatives).
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
      </div>

      {isError && (
        <p className="text-[14px] text-muted-foreground">
          Usage metrics are unavailable on this deployment.
        </p>
      )}
      {isPending && !isError && (
        <p className="text-[14px] text-muted-foreground">Loading usage…</p>
      )}
      {data && (
        <>
          <SectionLabel spaced>Total spend</SectionLabel>
          <div className="mb-8 text-[32px] font-semibold tabular-nums text-foreground">
            {formatUsd(total)}
          </div>
          <SectionLabel spaced>Spend by model</SectionLabel>
          {data.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">
              No LLM calls in {monthLabel}.
            </p>
          ) : (
            <Card className="p-4 text-[12px]">
              <ModelSpendTable rows={data} />
            </Card>
          )}
          {byDay.data && (
            <>
              <SectionLabel spaced>Spend by day</SectionLabel>
              <Card className="p-4">
                <SpendByDayColumns days={dailySpend} />
              </Card>
            </>
          )}
          {byAgent.data && byAgent.data.length > 0 && (
            <>
              <SectionLabel spaced>Spend by agent</SectionLabel>
              <Card className="p-4">
                <SpendByAgentBars rows={byAgent.data} />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Hand-rolled column chart, one column per calendar day of the selected month
 *  (already zero-filled and truncated at today by the caller). Column height is
 *  relative to the biggest day; any nonzero day keeps a visible nub so light
 *  days don't vanish. Hover a column for its exact date and USD amount. No chart
 *  library — deliberately just Tailwind. */
function SpendByDayColumns({ days }: { days: SpendByDay[] }) {
  const max = days.reduce((m, day) => Math.max(m, day.costUsd), 0);
  return (
    <div
      className="flex h-40 items-end gap-px"
      role="img"
      aria-label="LLM spend per day"
    >
      {days.map((day) => {
        const [year, month1, date] = day.day.split("-").map(Number);
        const label = new Date(year, month1 - 1, date).toLocaleDateString(
          undefined,
          { month: "short", day: "numeric" },
        );
        const pct =
          day.costUsd > 0 && max > 0
            ? Math.max((day.costUsd / max) * 100, 4)
            : 0;
        return (
          <div
            key={day.day}
            className="flex h-full flex-1 items-end"
            title={`${label} · ${formatUsd(day.costUsd)}`}
          >
            <div
              className="w-full rounded-t-sm bg-accent"
              style={{ height: `${pct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Hand-rolled horizontal bars, one per agent, sorted highest cost first (the
 *  API already sorts them). Bar length is relative to the biggest spender, so
 *  the top row is always full-width and the rest read proportionally. No chart
 *  library — deliberately just Tailwind. */
function SpendByAgentBars({ rows }: { rows: SpendByAgent[] }) {
  const max = rows[0]?.costUsd ?? 0;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.agentId}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span
              className="truncate text-foreground"
              title={row.agentName || row.agentId}
            >
              {row.agentName || row.agentId}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">
              {formatUsd(row.costUsd)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent"
              style={{
                width: `${max > 0 ? (row.costUsd / max) * 100 : 0}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
