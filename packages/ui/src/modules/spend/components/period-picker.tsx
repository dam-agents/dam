import { Calendar, ChevronLeft, ChevronRight } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  calendarFooter,
  CHOOSE_DATES,
  DONE,
  NEXT_PERIOD,
  PERIOD_LABELS,
  PREVIOUS_PERIOD,
} from "../lib/copy.js";
import { localDayStart } from "../lib/format.js";
import { formatRange } from "../lib/range-label.js";
import {
  periodOfRange,
  PRESET_PERIODS,
  type PresetPeriod,
  rangeOf,
  type SpendPeriod,
  stepPeriod,
} from "../lib/spend-period.js";
import { monthStartOf } from "../lib/utc-day.js";
import { PeriodCalendar } from "./period-calendar.js";

interface Props {
  period: SpendPeriod;
  onPeriodChange: (period: SpendPeriod) => void;
  startDay: string;
  today: string;
}

export function PeriodPicker({
  period,
  onPeriodChange,
  startDay,
  today,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pickStart, setPickStart] = useState<string | null>(null);
  const range = rangeOf(period, today);
  const [month, setMonth] = useState(() => monthStartOf(range.from));
  const next = stepPeriod(period, 1, today);
  const label = formatRange(range);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    setPickStart(null);
    if (nextOpen) setMonth(monthStartOf(range.from));
  }

  function handlePreset(preset: PresetPeriod) {
    setPickStart(null);
    setMonth(monthStartOf(rangeOf(preset, today).from));
    onPeriodChange(preset);
  }

  function handlePick(day: string) {
    if (pickStart === null) {
      setPickStart(day);
      onPeriodChange(periodOfRange({ from: day, to: day }, today));
      return;
    }
    const [from, to] = pickStart <= day ? [pickStart, day] : [day, pickStart];
    setPickStart(null);
    onPeriodChange(periodOfRange({ from, to }, today));
  }

  return (
    <div className="flex items-center rounded-md border border-border bg-card">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={PREVIOUS_PERIOD}
        onClick={() => onPeriodChange(stepPeriod(period, -1, today))}
      >
        <ChevronLeft size={16} />
      </Button>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${CHOOSE_DATES}, ${label}`}
            className="rounded-none border-x border-border-hairline font-normal tabular-nums"
          >
            <Calendar size={16} />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          tail={false}
          aria-label={CHOOSE_DATES}
          className="flex w-auto flex-col p-0 sm:flex-row"
        >
          <div className="flex min-w-[150px] flex-col gap-0.5 border-b border-border-hairline p-3 sm:border-b-0 sm:border-r">
            {PRESET_PERIODS.map((preset) => (
              <Button
                key={preset}
                variant="ghost"
                size="sm"
                onClick={() => handlePreset(preset)}
                className={cn(
                  "justify-start",
                  period === preset &&
                    "bg-accent-light font-medium text-accent hover:bg-accent-light hover:text-accent",
                )}
              >
                {PERIOD_LABELS[preset]}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-3 p-3">
            <PeriodCalendar
              month={month}
              selection={range}
              pickStart={pickStart}
              startDay={startDay}
              today={today}
              onMonthChange={setMonth}
              onPick={handlePick}
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {calendarFooter(localDayStart(today))}
              </span>
              <PopoverClose asChild>
                <Button size="sm">{DONE}</Button>
              </PopoverClose>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={NEXT_PERIOD}
        disabled={rangeOf(next, today).from > today}
        onClick={() => onPeriodChange(next)}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  );
}
