import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import { SPEND_DAILY_MAX_DAYS } from "api-server-api";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  AT_MOST_DAYS,
  NEXT_MONTH,
  NOT_MEASURED_YET,
  PREVIOUS_MONTH,
  WEEKDAYS,
  weekLabel,
} from "../lib/copy.js";
import { formatDay, formatMonth } from "../lib/range-label.js";
import {
  addDays,
  addMonths,
  type DayRange,
  daysSpanned,
  isoWeekOf,
  mondayOf,
  monthEndOf,
} from "../lib/utc-day.js";

interface Props {
  month: string;
  selection: DayRange;
  pickStart: string | null;
  startDay: string;
  today: string;
  onMonthChange: (month: string) => void;
  onPick: (day: string) => void;
}

function weeksOf(month: string): string[] {
  const weeks: string[] = [];
  for (
    let monday = mondayOf(month);
    monday <= monthEndOf(month);
    monday = addDays(monday, 7)
  ) {
    weeks.push(monday);
  }
  return weeks;
}

export function PeriodCalendar({
  month,
  selection,
  pickStart,
  startDay,
  today,
  onMonthChange,
  onPick,
}: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={PREVIOUS_MONTH}
          tooltip={PREVIOUS_MONTH}
          onClick={() => onMonthChange(addMonths(month, -1))}
        >
          <ChevronLeft size={14} />
        </Button>
        <span className="text-sm font-medium text-foreground">
          {formatMonth(month)}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={NEXT_MONTH}
          tooltip={NEXT_MONTH}
          onClick={() => onMonthChange(addMonths(month, 1))}
        >
          <ChevronRight size={14} />
        </Button>
      </div>
      <div className="grid grid-cols-8 gap-0.5 text-center text-xs text-muted-foreground">
        <span />
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      {weeksOf(month).map((monday) => (
        <div key={monday} className="grid grid-cols-8 gap-0.5">
          <span className="flex items-center justify-center rounded bg-muted text-xs text-muted-foreground">
            {weekLabel(isoWeekOf(monday))}
          </span>
          {Array.from({ length: 7 }, (_, i) => (
            <CalendarDay
              key={i}
              day={addDays(monday, i)}
              month={month}
              selection={selection}
              pickStart={pickStart}
              startDay={startDay}
              today={today}
              onPick={onPick}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function dayHint(tooFar: boolean, notMeasured: boolean): string | undefined {
  if (tooFar) return AT_MOST_DAYS;
  if (notMeasured) return NOT_MEASURED_YET;
  return undefined;
}

function CalendarDay({
  day,
  month,
  selection,
  pickStart,
  startDay,
  today,
  onPick,
}: {
  day: string;
  month: string;
  selection: DayRange;
  pickStart: string | null;
  startDay: string;
  today: string;
  onPick: (day: string) => void;
}) {
  const inMonth = day.slice(0, 7) === month.slice(0, 7);
  const edge = day === selection.from || day === selection.to;
  const inside = day > selection.from && day < selection.to;
  const notMeasured = day < startDay;
  const tooFar =
    pickStart !== null && daysSpanned(pickStart, day) > SPEND_DAILY_MAX_DAYS;
  const hint = dayHint(tooFar, notMeasured);

  function handleClick() {
    if (!tooFar) onPick(day);
  }

  return (
    <button
      type="button"
      title={hint}
      aria-label={hint ? `${formatDay(day)}, ${hint}` : formatDay(day)}
      aria-pressed={edge}
      aria-disabled={tooFar || undefined}
      disabled={day > today}
      onClick={handleClick}
      className={cn(
        "h-8 rounded-md text-sm tabular-nums transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40",
        inMonth ? "text-foreground" : "text-muted-foreground/60",
        inside && "bg-accent-light text-accent hover:bg-accent-light",
        edge &&
          "bg-primary font-semibold text-primary-foreground hover:bg-primary",
        notMeasured && "line-through decoration-muted-foreground",
        notMeasured && !edge && !inside && "text-muted-foreground",
        tooFar && "cursor-not-allowed opacity-40",
      )}
    >
      {Number(day.slice(8, 10))}
    </button>
  );
}
