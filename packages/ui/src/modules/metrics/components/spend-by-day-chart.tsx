import type { SpendByDay } from "api-server-api";

import { formatAxisUsd, formatUsd } from "../lib/format.js";

export const CHART_HEIGHT_CLASS = "h-[240px]";

function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const rawStep = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceStep = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / niceStep) * niceStep, step: niceStep };
}

function DayColumn({ day, top }: { day: SpendByDay; top: number }) {
  const dayNum = Number(day.day.slice(8, 10));
  const pct = top > 0 ? (day.costUsd / top) * 100 : 0;
  return (
    <div
      title={`${day.day}: ${formatUsd(day.costUsd)}`}
      className="group flex h-full min-w-0 flex-1 items-end justify-center"
    >
      <div
        className="w-[58%] rounded-t-[2px] bg-accent group-hover:bg-accent-hover"
        style={{ height: day.costUsd > 0 ? `max(${pct}%, 3px)` : "0px" }}
      />
      {}
      <span className="sr-only">
        Day {dayNum}: {formatUsd(day.costUsd)}
      </span>
    </div>
  );
}

export function SpendByDayChart({ days }: { days: SpendByDay[] }) {
  const max = days.reduce((m, d) => Math.max(m, d.costUsd), 0);
  const { top, step } = niceScale(max);
  const nTicks = Math.round(top / step);
  const ticks = Array.from(
    { length: nTicks + 1 },
    (_, i) => (nTicks - i) * step,
  );

  return (
    <div className="flex gap-3">
      {}
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
          {}
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((t) => (
              <div key={t} className="border-t border-border-hairline" />
            ))}
          </div>
          {}
          <div className="absolute inset-0 flex items-end gap-1">
            {days.map((d) => (
              <DayColumn key={d.day} day={d} top={top} />
            ))}
          </div>
        </div>
        <div className="mt-3 flex gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          {days.map((d) => {
            const dayNum = Number(d.day.slice(8, 10));
            return (
              <span key={d.day} className="min-w-0 flex-1 text-center">
                {dayNum % 2 === 1 ? dayNum : ""}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
