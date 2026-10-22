import { ChevronDown } from "@carbon/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { ALSO_COUNTED_BY } from "../lib/copy.js";
import { type GroupedLevel, levelPercent } from "../lib/limit-levels.js";
import { LIMIT_STATE_TEXT } from "../lib/state-colors.js";
import { type LevelAgent, LevelIcon } from "./level-icon.js";
import { LevelList } from "./level-list.js";

interface Props {
  levels: readonly GroupedLevel[];
  agentId: string | null;
  agent: LevelAgent | null;
  grouped?: boolean;
}

export function AlsoCountedBy({
  levels,
  agentId,
  agent,
  grouped = false,
}: Props) {
  const [open, setOpen] = useState(false);
  if (levels.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="-mx-1.5 flex w-[calc(100%+12px)] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{ALSO_COUNTED_BY}</span>
        {!open &&
          levels.map(({ level }) => (
            <span
              key={level.key}
              className={cn(
                "inline-flex items-center gap-1.5 tabular-nums",
                level.state !== "ok" && LIMIT_STATE_TEXT[level.state],
              )}
            >
              <LevelIcon level={level} agent={agent} small />
              {`${String(levelPercent(level))}%`}
              {level.stopsFirst && " · stops first"}
            </span>
          ))}
        <ChevronDown
          size={14}
          aria-hidden
          className={cn(
            "ml-auto shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <LevelList
          levels={levels}
          agentId={agentId}
          agent={agent}
          grouped={grouped}
        />
      )}
    </div>
  );
}
