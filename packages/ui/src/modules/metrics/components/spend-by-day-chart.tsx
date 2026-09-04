export const CHART_HEIGHT_CLASS = "h-[240px]";

export interface DayValue {
  day: string;
  value: number;
}

interface Props {
  days: DayValue[];
  formatValue: (value: number) => string;
  formatAxis: (value: number, step: number) => string;
}

function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const rawStep = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceStep = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / niceStep) * niceStep, step: niceStep };
}

function DayColumn({
  day,
  top,
  formatValue,
}: {
  day: DayValue;
  top: number;
  formatValue: (value: number) => string;
}) {
  const dayNum = Number(day.day.slice(8, 10));
  const pct = top > 0 ? (day.value / top) * 100 : 0;
  return (
    <div
      title={`${day.day}: ${formatValue(day.value)}`}
      className="group flex h-full min-w-0 flex-1 items-end justify-center"
    >
      <div
        className="w-[58%] rounded-t-[2px] bg-accent group-hover:bg-accent-hover"
        style={{ height: day.value > 0 ? `max(${pct}%, 3px)` : "0px" }}
      />
      {}
      <span className="sr-only">
        Day {dayNum}: {formatValue(day.value)}
      </span>
    </div>
  );
}

export function SpendByDayChart({ days, formatValue, formatAxis }: Props) {
  const max = days.reduce((m, d) => Math.max(m, d.value), 0);
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
            {formatAxis(t, step)}
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
              <DayColumn
                key={d.day}
                day={d}
                top={top}
                formatValue={formatValue}
              />
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
