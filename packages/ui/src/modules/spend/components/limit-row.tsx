import { limitShareLabel, ofLimit } from "../lib/copy.js";
import { meterAmount } from "../lib/format.js";
import { levelListName } from "../lib/level-labels.js";
import { type Level, levelPercent } from "../lib/limit-levels.js";
import { type LevelAgent, LevelIcon } from "./level-icon.js";
import { LimitBar } from "./limit-bar.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: one limit with the spend it counts today, as
 * every limit list shows it: its icon, its name, a black meter across the
 * rest of the row, and the spend over the limit's amount.
 */
export function LimitRow({
  level,
  agent,
  name = levelListName(level),
}: {
  level: Level;
  agent: LevelAgent | null;
  name?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <LevelIcon level={level} agent={agent} />
      <span
        title={name}
        className="w-[34%] min-w-0 shrink-0 truncate text-sm text-foreground"
      >
        {name}
      </span>
      <LimitBar
        pct={levelPercent(level)}
        label={limitShareLabel(name, levelPercent(level))}
        percent={false}
        className="min-w-0 flex-1"
      />
      <LimitAmounts
        spentMicros={level.spentMicros}
        amountMicros={level.effectiveMicros}
        unit={level.unit}
      />
    </div>
  );
}

export function LimitAmounts({
  spentMicros,
  amountMicros,
  unit,
}: {
  spentMicros: number;
  amountMicros: number;
  unit: Level["unit"];
}) {
  return (
    <span className="flex min-w-16 shrink-0 flex-col items-end leading-tight whitespace-nowrap tabular-nums">
      <span className="text-sm text-foreground">
        {meterAmount(spentMicros, unit)}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {ofLimit(meterAmount(amountMicros, unit))}
      </span>
    </span>
  );
}

export function LimitRowList({
  id,
  levels,
  agent,
}: {
  id?: string;
  levels: readonly Level[];
  agent: LevelAgent | null;
}) {
  if (levels.length === 0) return null;
  return (
    <ul id={id} className="flex scroll-mt-4 flex-col gap-3">
      {levels.map((level) => (
        <li key={level.key}>
          <LimitRow level={level} agent={agent} />
        </li>
      ))}
    </ul>
  );
}
