import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  amountToday,
  LEVEL_GROUP_NAMES,
  partLeft,
  partOtherAgents,
  partThisAgent,
  setIn,
  spentOfLimit,
  STOPS_FIRST,
} from "../lib/copy.js";
import { bareSpend } from "../lib/format.js";
import { levelName, levelPlace, levelScope } from "../lib/level-labels.js";
import {
  type GroupedLevel,
  type Level,
  levelPercent,
} from "../lib/limit-levels.js";
import { LIMIT_STATE_PERCENT, LIMIT_STATE_TEXT } from "../lib/state-colors.js";
import { type LevelAgent, LevelIcon } from "./level-icon.js";
import { SharedLimitBar } from "./shared-limit-bar.js";

interface Props {
  levels: readonly GroupedLevel[];
  agentId: string | null;
  agent: LevelAgent | null;
  grouped: boolean;
}

export function LevelList({ levels, agentId, agent, grouped }: Props) {
  return (
    <ul className="flex flex-col gap-3 pt-2.5 pb-0.5">
      {levels.map(({ level, group }, index) => {
        const heading =
          grouped && (index === 0 || levels[index - 1]?.group !== group);
        return (
          <li key={level.key} className="flex flex-col gap-1">
            {heading && (
              <p className="ml-[30px] text-[11px] text-muted-foreground">
                {LEVEL_GROUP_NAMES[group]}
              </p>
            )}
            <LevelRow level={level} agentId={agentId} agent={agent} />
          </li>
        );
      })}
    </ul>
  );
}

function LevelRow({
  level,
  agentId,
  agent,
}: {
  level: Level;
  agentId: string | null;
  agent: LevelAgent | null;
}) {
  const money = (micros: number) => bareSpend(micros, level.unit);
  const scope = levelScope(level);
  const others =
    level.mineMicros === null
      ? undefined
      : {
          micros: Math.max(0, level.spentMicros - level.mineMicros),
          label: partOtherAgents(
            money(Math.max(0, level.spentMicros - level.mineMicros)),
          ),
        };
  const mine = level.mineMicros ?? level.spentMicros;

  return (
    <div className="grid grid-cols-[20px_1fr_40px] items-center gap-x-2.5">
      <LevelIcon level={level} agent={agent} />
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="min-w-0 text-[13px] text-muted-foreground">
            {levelName(level)}
            {level.stopsFirst && (
              <span
                className={cn(
                  "ml-1.5 rounded-full border border-current px-1.5 text-[11px] font-medium",
                  level.state === "ok"
                    ? "text-muted-foreground"
                    : LIMIT_STATE_TEXT[level.state],
                )}
              >
                {STOPS_FIRST}
              </span>
            )}
          </span>
          <PlaceLink level={level} agentId={agentId} />
        </div>
        <SharedLimitBar
          muted
          state={level.state}
          limitMicros={level.effectiveMicros}
          mine={{ micros: mine, label: partThisAgent(money(mine)) }}
          {...(others && { others })}
          left={{
            micros: level.leftMicros,
            label: partLeft(money(level.leftMicros)),
          }}
          label={levelName(level)}
        />
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {amountToday(
            spentOfLimit(level.spentMicros, level.amountMicros, level.unit),
          )}
          {scope && ` · ${scope}`}
        </p>
      </div>
      <span
        className={cn(
          "text-right text-xs tabular-nums",
          LIMIT_STATE_PERCENT[level.state],
        )}
      >
        {`${String(levelPercent(level))}%`}
      </span>
    </div>
  );
}

function PlaceLink({
  level,
  agentId,
}: {
  level: Level;
  agentId: string | null;
}) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const place = levelPlace(level);
  if (!place || (place.kind === "agent" && !agentId)) return null;
  return (
    <span className="shrink-0 text-[11px] text-muted-foreground">
      {setIn("")}
      <Button
        variant="link"
        size="inline"
        className="text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2"
        onClick={() =>
          place.kind === "settings"
            ? navigateToSettings(place.tab)
            : agentId && navigateToSandboxHome(agentId, place.section)
        }
      >
        {place.label}
      </Button>
    </span>
  );
}
