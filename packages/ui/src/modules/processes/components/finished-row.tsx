import { Asleep, Checkmark, StopFilledAlt } from "@carbon/icons-react";
import type { FinishedRow as FinishedRowData } from "agent-runtime-api";
import { match } from "ts-pattern";

import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import { timeAgo } from "../../../lib/format-time.js";
import { ENDED_BY_LABEL } from "../lib/process-copy.js";
import { ProcessCommand } from "./process-command.js";

interface Props {
  row: FinishedRowData;
  now: Date;
  outputOpen: boolean;
  onOpenOutput: (key: string) => void;
}

export function FinishedRow({ row, now, outputOpen, onOpenOutput }: Props) {
  const hasOutput = row.outputPath !== null;
  return (
    <li
      data-testid="finished-process-row"
      aria-pressed={hasOutput ? outputOpen : undefined}
      className={cn(
        "flex items-center gap-2 border-b border-border px-4 py-1.5 text-[11px] text-muted-foreground transition-colors",
        hasOutput && "cursor-pointer",
        outputOpen ? "bg-muted" : hasOutput && "hover:bg-muted/60",
      )}
      {...clickableProps(hasOutput ? () => onOpenOutput(row.key) : undefined)}
    >
      <EndedIcon endedBy={row.endedBy} />
      <ProcessCommand command={row.command} />
      <span className="shrink-0 tabular-nums">
        {timeAgo(row.finishedAt, now)}
      </span>
    </li>
  );
}

function EndedIcon({ endedBy }: { endedBy: FinishedRowData["endedBy"] }) {
  const label = ENDED_BY_LABEL[endedBy];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex w-3.5 shrink-0 justify-center"
    >
      {match(endedBy)
        .with("exit", () => <Checkmark size={14} className="text-success" />)
        .with("stop", () => <StopFilledAlt size={12} className="text-danger" />)
        .with("hibernation", () => <Asleep size={12} />)
        .exhaustive()}
    </span>
  );
}
