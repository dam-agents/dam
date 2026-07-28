import type { SpendByDay } from "api-server-api";

import { formatAxisUsd, formatUsd } from "../lib/format.js";

/** Plot height for the day chart. Shared so the loading/error/empty cards in
 *  the Usage view reserve the exact same height and the layout never jumps. */
export const CHART_HEIGHT_CLASS = "h-[240px]";

// Choose a "nice" axis top and step so the horizontal gridlines land on round
// numbers (e.g. $0 / $20 / $40 …) rather than raw fractions of the max.
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const rawStep = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceStep = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / niceStep) * niceStep, step: niceStep };
}

/** One column of the day chart: cost → height against the shared nice top.
 *  The bar is centred in its flex slot at ~58% width so the plot reads light;
 *  a nonzero day gets a 3px floor so it stays legible. */
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
      {/* Hover shows the exact amount via title; this backs it for screen
          readers. */}
      <span className="sr-only">
        Day {dayNum}: {formatUsd(day.costUsd)}
      </span>
    </div>
  );
}

/** Hand-rolled column chart — one column per calendar day of the selected
 *  month. The caller owns calendar semantics: it passes the full, already
 *  zero-filled day list (and, for the current month, stops at today), so this
 *  only maps cost → height. The tallest column sets the scale; hovering a
 *  column reveals its exact USD. Deliberately no chart library. */
export function SpendByDayChart({ days }: { days: SpendByDay[] }) {
  const max = days.reduce((m, d) => Math.max(m, d.costUsd), 0);
  const { top, step } = niceScale(max);
  // Gridline / axis values, top row first so flex order reads high → low.
  // Index-based so the bottom tick is exactly 0 (no floating-point residual).
  const nTicks = Math.round(top / step);
  const ticks = Array.from(
    { length: nTicks + 1 },
    (_, i) => (nTicks - i) * step,
  );

  return (
    <div className="flex gap-3">
      {/* Y-axis labels, one per gridline, vertically aligned to the plot. */}
      <div
        className={`flex flex-col justify-between text-right font-mono text-[12px] tabular-nums text-text-muted ${CHART_HEIGHT_CLASS}`}
      >
        {ticks.map((t) => (
          <span key={t} className="leading-none">
            {formatAxisUsd(t, step)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`relative ${CHART_HEIGHT_CLASS}`}>
          {/* Horizontal gridlines, evenly spaced behind the bars. */}
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((t) => (
              <div key={t} className="border-t border-border-hairline" />
            ))}
          </div>
          {/* Bars, anchored to the baseline, scaled against the nice top. */}
          <div className="absolute inset-0 flex items-end gap-1">
            {days.map((d) => (
              <DayColumn key={d.day} day={d} top={top} />
            ))}
          </div>
        </div>
        <div className="mt-3 flex gap-1 font-mono text-[10px] tabular-nums text-text-muted">
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
