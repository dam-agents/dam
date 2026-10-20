import type { SpendByDay } from "api-server-api";

import { cn } from "@/lib/utils";

import { NEUTRAL_LIGHT_FILL } from "../../budgets/lib/pool-colors.js";
import { formatAxisUsd, formatUsd } from "../lib/format.js";

export const CHART_HEIGHT_CLASS = "h-[240px]";

export interface ChartColumn extends SpendByDay {
  planUsd?: number;
  title?: string;
  axisLabel?: string;
}

function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const rawStep = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceStep = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / niceStep) * niceStep, step: niceStep };
}

function columnTitle(column: ChartColumn): string {
  return column.title ?? `${column.day}: ${formatUsd(column.costUsd)}`;
}

function defaultAxisLabel(column: ChartColumn): string {
  const dayNum = Number(column.day.slice(8, 10));
  return dayNum % 2 === 1 ? String(dayNum) : "";
}

function DayColumn({ column, top }: { column: ChartColumn; top: number }) {
  const planUsd = column.planUsd ?? 0;
  const pct = (usd: number) => (top > 0 ? (usd / top) * 100 : 0);
  return (
    <div
      title={columnTitle(column)}
      className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"
    >
      {planUsd > 0 && (
        <div
          className={cn("w-[58%] shrink-0 rounded-t-[2px]", NEUTRAL_LIGHT_FILL)}
          style={{ height: `max(${pct(planUsd)}%, 3px)` }}
        />
      )}
      <div
        className={cn(
          "w-[58%] shrink-0 bg-accent group-hover:bg-accent-hover",
          planUsd === 0 && "rounded-t-[2px]",
        )}
        style={{
          height:
            column.costUsd > 0 ? `max(${pct(column.costUsd)}%, 3px)` : "0px",
        }}
      />
      <span className="sr-only">
        {column.title ??
          `Day ${Number(column.day.slice(8, 10))}: ${formatUsd(column.costUsd)}`}
      </span>
    </div>
  );
}

export function SpendByDayChart({ days }: { days: ChartColumn[] }) {
  const max = days.reduce(
    (m, d) => Math.max(m, d.costUsd + (d.planUsd ?? 0)),
    0,
  );
  const { top, step } = niceScale(max);
  const nTicks = Math.round(top / step);
  const ticks = Array.from(
    { length: nTicks + 1 },
    (_, i) => (nTicks - i) * step,
  );

  return (
    <div className="flex gap-3">
      <div
        className={`flex flex-col justify-between text-right font-mono text-xs tabular-nums text-muted-foreground ${CHART_HEIGHT_CLASS}`}
      >
        {ticks.map((t) => (
          <span key={t} className="leading-none">
            {formatAxisUsd(t, step)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`relative ${CHART_HEIGHT_CLASS}`}>
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((t) => (
              <div key={t} className="border-t border-border-hairline" />
            ))}
          </div>
          <div className="absolute inset-0 flex items-end gap-1">
            {days.map((d) => (
              <DayColumn key={d.day} column={d} top={top} />
            ))}
          </div>
        </div>
        <div className="mt-3 flex gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          {days.map((d) => (
            <span
              key={d.day}
              className="min-w-0 flex-1 whitespace-nowrap text-center"
            >
              {d.axisLabel ?? defaultAxisLabel(d)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
