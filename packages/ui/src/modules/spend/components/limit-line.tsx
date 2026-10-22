import { ChevronDown } from "@carbon/icons-react";
import type { SpendLimitScope, SpendUnit } from "api-server-api";
import { type KeyboardEvent, useState } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  amountToday,
  partLeft,
  partSpent,
  partThisAgent,
  spentOfLimit,
  stopsFirstShort,
  usedToday,
} from "../lib/copy.js";
import { bareSpend } from "../lib/format.js";
import { levelShort } from "../lib/level-labels.js";
import { levelPercent, type LevelsView } from "../lib/limit-levels.js";
import { LIMIT_STATE_PERCENT, LIMIT_STATE_TEXT } from "../lib/state-colors.js";
import type { LevelAgent } from "./level-icon.js";
import { LevelList } from "./level-list.js";
import { SharedLimitBar } from "./shared-limit-bar.js";
import { SpendLimitButton } from "./spend-limit-button.js";
import type { LimitComparison } from "./spend-limit-dialog.js";

interface Props {
  view: LevelsView;
  spentMicros: number;
  unit: SpendUnit;
  scope: SpendLimitScope;
  subject: string;
  buttonTip: string;
  agentId: string | null;
  agent: LevelAgent | null;
  compare?: LimitComparison;
}

export function LimitLine({
  view,
  spentMicros,
  unit,
  scope,
  subject,
  buttonTip,
  agentId,
  agent,
  compare,
}: Props) {
  const [open, setOpen] = useState(false);
  const { current, others } = view;
  const expandable = others.length > 0;
  const first = others.find(({ level }) => level.stopsFirst)?.level;
  const toggle = () => expandable && setOpen((was) => !was);
  const onKey = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };
  const money = (micros: number) => bareSpend(micros, unit);

  return (
    <div className="flex flex-col">
      <div
        {...(expandable && {
          role: "button",
          tabIndex: 0,
          "aria-expanded": open,
          onClick: toggle,
          onKeyDown: onKey,
        })}
        className={cn(
          "-m-1.5 grid grid-cols-[1fr_40px_auto_22px] items-center gap-x-2.5 gap-y-1 rounded-md p-1.5",
          expandable &&
            "cursor-pointer transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {current ? (
          <>
            <SharedLimitBar
              state={current.state}
              limitMicros={current.effectiveMicros}
              mine={{
                micros: current.spentMicros,
                label: agentId
                  ? partThisAgent(money(current.spentMicros))
                  : partSpent(money(current.spentMicros)),
              }}
              left={{
                micros: current.leftMicros,
                label: partLeft(money(current.leftMicros)),
              }}
              label={subject}
            />
            <span
              className={cn(
                "text-right text-xs tabular-nums",
                LIMIT_STATE_PERCENT[current.state],
              )}
            >
              {`${String(levelPercent(current))}%`}
            </span>
          </>
        ) : (
          <span className="col-span-2 text-[13px] tabular-nums">
            {usedToday(spentMicros, unit)}
            <span className="text-muted-foreground"> · No limit</span>
          </span>
        )}
        <span
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Tooltip content={buttonTip}>
            <span>
              <SpendLimitButton
                scope={scope}
                subject={subject}
                amountMicros={current?.amountMicros ?? null}
                unit={unit}
                {...(compare && { compare })}
              />
            </span>
          </Tooltip>
        </span>
        {expandable ? (
          <ChevronDown
            size={14}
            aria-hidden
            className={cn(
              "justify-self-center text-muted-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        ) : (
          <span />
        )}
        {(current || first) && (
          <span className="col-span-1 -mt-0.5 text-[11px] text-muted-foreground tabular-nums">
            {current &&
              amountToday(
                spentOfLimit(current.spentMicros, current.amountMicros, unit),
              )}
            {first && (
              <>
                {current && " · "}
                <b
                  className={cn(
                    "font-medium",
                    first.state !== "ok" && LIMIT_STATE_TEXT[first.state],
                  )}
                >
                  {stopsFirstShort(levelShort(first, true))}
                </b>
              </>
            )}
          </span>
        )}
      </div>
      {open && expandable && (
        <LevelList
          levels={others}
          agentId={agentId}
          agent={agent}
          grouped={false}
        />
      )}
    </div>
  );
}
