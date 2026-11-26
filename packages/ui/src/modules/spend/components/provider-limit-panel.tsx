import { ChevronDown } from "@carbon/icons-react";
import type { SpendUnit } from "api-server-api";
import type { ReactNode } from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { cn } from "@/lib/utils";

import { limitShareLabel, resetsAtLine, showLimitLabel } from "../lib/copy.js";
import { localResetTime, meterAmount } from "../lib/format.js";
import { type Level, levelPercent } from "../lib/limit-levels.js";
import { type LevelAgent, LevelIcon } from "./level-icon.js";
import { LimitBar } from "./limit-bar.js";
import { LimitAmounts } from "./limit-row.js";

interface Toggle {
  open: boolean;
  onToggle: () => void;
  controls: string;
  subject: string;
}

/** UNIT_BOUNDARY_DESCRIPTION: a provider row's spend today, as plain text that opens the row's limit below it. */
export function SpendToggle({
  spentMicros,
  unit,
  toggle,
}: {
  spentMicros: number;
  unit: SpendUnit;
  toggle: Toggle;
}) {
  return (
    <button
      type="button"
      aria-expanded={toggle.open}
      aria-controls={toggle.controls}
      aria-label={showLimitLabel(toggle.open, toggle.subject)}
      data-testid="provider-spend-toggle"
      onClick={toggle.onToggle}
      className={cn(
        "shrink-0 rounded-xs text-sm text-foreground tabular-nums whitespace-nowrap hover:underline",
        FOCUS_RING,
      )}
    >
      {meterAmount(spentMicros, unit)}
    </button>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: the chevron at the end of a provider row, which opens and closes the same limit as its spend. */
export function LimitChevron({ toggle }: { toggle: Toggle }) {
  return (
    <button
      type="button"
      aria-expanded={toggle.open}
      aria-controls={toggle.controls}
      aria-label={showLimitLabel(toggle.open, toggle.subject)}
      onClick={toggle.onToggle}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        FOCUS_RING,
      )}
    >
      <ChevronDown
        size={16}
        aria-hidden
        className={cn(
          "transition-transform motion-reduce:transition-none",
          toggle.open && "rotate-180",
        )}
      />
    </button>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one limit under an open provider row: its icon
 * and name, a black meter across the row with the spend over the limit, the
 * button that sets it, and when it resets. With no limit set, the row gives
 * the spend alone beside the button.
 */
export function ProviderLimitBlock({
  icon,
  agent,
  name,
  level,
  spentMicros,
  unit,
  action,
  resetsAt,
}: {
  icon: Pick<Level, "kind" | "connection">;
  agent: LevelAgent | null;
  name: string;
  level: Level | null;
  spentMicros: number;
  unit: SpendUnit;
  action?: ReactNode;
  resetsAt?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-8 items-center gap-2.5">
        <LevelIcon level={icon} agent={agent} />
        <span
          title={name}
          className="w-[34%] min-w-0 shrink-0 truncate text-[13px] text-foreground"
        >
          {name}
        </span>
        {level ? (
          <>
            <LimitBar
              pct={levelPercent(level)}
              label={limitShareLabel(name, levelPercent(level))}
              percent={false}
              className="min-w-0 flex-1"
            />
            <LimitAmounts
              spentMicros={level.spentMicros}
              amountMicros={level.amountMicros}
              unit={unit}
            />
          </>
        ) : (
          <span className="flex-1 text-right text-sm text-foreground tabular-nums whitespace-nowrap">
            {meterAmount(spentMicros, unit)}
          </span>
        )}
        {action}
      </div>
      {resetsAt && level && (
        <p className="ml-[30px] text-xs text-muted-foreground">
          {resetsAtLine(localResetTime(resetsAt))}
        </p>
      )}
    </div>
  );
}
