import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { NEUTRAL_LIGHT_FILL } from "../../budgets/lib/pool-colors.js";
import {
  BOB_HELP,
  bobLine,
  measuringStarted,
  MOSTLY_PLAN_USE,
  notMeasured,
  planUseLine,
  rangeLine,
} from "../lib/copy.js";
import {
  isMostlyPlanUse,
  type UnitAmounts,
  VISIBLE_MICROS,
} from "../lib/measured-spend.js";
import { measuredRange } from "../lib/range-label.js";
import type { DayRange } from "../lib/utc-day.js";
import { HelpTip } from "./help-tip.js";

const LINE = "text-sm text-muted-foreground";

export function SpendRangeLine({
  range,
  startDay,
}: {
  range: DayRange;
  startDay: string;
}) {
  const measured = measuredRange(range, startDay);
  if (!measured) return <p className={LINE}>{notMeasured(startDay)}</p>;
  if (measured.from === range.from) {
    return <p className={LINE}>{rangeLine(range)}</p>;
  }
  return (
    <p className={LINE}>
      <Tooltip content={measuringStarted(startDay)}>
        <span
          tabIndex={0}
          className="cursor-help underline decoration-dotted underline-offset-2"
        >
          {rangeLine(measured)}
        </span>
      </Tooltip>
    </p>
  );
}

export function SpendSideLines({
  totals,
  showPlanUse,
}: {
  totals: UnitAmounts;
  showPlanUse: boolean;
}) {
  return (
    <>
      {showPlanUse && totals.usd_list >= VISIBLE_MICROS && (
        <p className={cn(LINE, "flex items-center gap-1.5")}>
          <span
            aria-hidden="true"
            className={cn("size-2.5 shrink-0 rounded-sm", NEUTRAL_LIGHT_FILL)}
          />
          {planUseLine(totals.usd_list)}
        </p>
      )}
      {isMostlyPlanUse(totals) && <p className={LINE}>{MOSTLY_PLAN_USE}</p>}
      {totals.bobcoin > 0 && (
        <p className={cn(LINE, "flex items-center gap-1.5")}>
          {bobLine(totals.bobcoin)}
          <HelpTip content={BOB_HELP} />
        </p>
      )}
    </>
  );
}
