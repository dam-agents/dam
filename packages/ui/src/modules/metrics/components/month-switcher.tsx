import { ChevronLeft, ChevronRight } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { monthLabel, monthStart } from "../lib/month-range.js";

interface Props {
  month: Date;
  isCurrentMonth: boolean;
  onChange: (month: Date) => void;
}

export function MonthSwitcher({ month, isCurrentMonth, onChange }: Props) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Previous month"
        onClick={() => onChange(monthStart(month, -1))}
      >
        <ChevronLeft size={16} className="text-muted-foreground" />
      </Button>
      <span className="min-w-[120px] text-center text-sm font-medium">
        {monthLabel(month)}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Next month"
        disabled={isCurrentMonth}
        onClick={() => onChange(monthStart(month, 1))}
      >
        <ChevronRight size={16} className="text-muted-foreground" />
      </Button>
    </div>
  );
}
