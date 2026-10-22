import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { NEUTRAL_LIGHT_FILL } from "../../budgets/lib/pool-colors.js";
import {
  bobHelp,
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
import { shownRange } from "../lib/range-label.js";
import type { DayRange } from "../lib/utc-day.js";
import { HelpTip } from "./help-tip.js";

const LINE = "text-sm text-muted-foreground";

export function SpendRangeLine({
  range,
  startDay,
  today,
}: {
  range: DayRange;
  startDay: string;
  today: string;
}) {
  const shown = shownRange(range, startDay, today);
  if (!shown) return <p className={LINE}>{notMeasured(startDay)}</p>;
  const text = rangeLine(shown.range, shown.soFar);
  if (!shown.cutAtStart) return <p className={LINE}>{text}</p>;
  return (
    <p className={LINE}>
      <Tooltip content={measuringStarted(startDay)}>
        <span
          tabIndex={0}
          className="cursor-help underline decoration-dotted underline-offset-2"
        >
          {text}
        </span>
      </Tooltip>
    </p>
  );
}

function PlanUseLine({ planMicros }: { planMicros: number }) {
  return (
    <p className={cn(LINE, "flex items-center gap-1.5")}>
      <span
        aria-hidden="true"
        className={cn("size-2.5 shrink-0 rounded-sm", NEUTRAL_LIGHT_FILL)}
      />
      {planUseLine(planMicros)}
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
        <PlanUseLine planMicros={totals.usd_list} />
      )}
      {isMostlyPlanUse(totals) && <p className={LINE}>{MOSTLY_PLAN_USE}</p>}
      {totals.bobcoin > 0 && (
        <p className={cn(LINE, "flex items-center gap-1.5")}>
          {bobLine(totals.bobcoin)}
          <HelpTip content={bobHelp()} />
        </p>
      )}
    </>
  );
}

export function SpendDetailLine({
  totals,
  showPlanUse,
}: {
  totals: UnitAmounts | null;
  showPlanUse: boolean;
}) {
  return (
    <div className="min-h-lh text-sm">
      {totals && <DetailText totals={totals} showPlanUse={showPlanUse} />}
    </div>
  );
}

function DetailText({
  totals,
  showPlanUse,
}: {
  totals: UnitAmounts;
  showPlanUse: boolean;
}) {
  if (showPlanUse && totals.usd_list >= VISIBLE_MICROS) {
    return <PlanUseLine planMicros={totals.usd_list} />;
  }
  if (!showPlanUse && isMostlyPlanUse(totals)) {
    return <p className={LINE}>{MOSTLY_PLAN_USE}</p>;
  }
  return null;
}
