import type { FinishedRow as FinishedRowData } from "agent-runtime-api";

import { cn } from "@/lib/utils";

import { timeAgo } from "../../../lib/format-time.js";
import { ENDED_BY_LABEL } from "../lib/process-copy.js";
import { OutputButton } from "./output-button.js";
import { ProcessCommand } from "./process-command.js";

interface Props {
  row: FinishedRowData;
  now: Date;
  outputOpen: boolean;
  onOpenOutput: (key: string) => void;
}

export function FinishedRow({ row, now, outputOpen, onOpenOutput }: Props) {
  return (
    <li
      data-testid="finished-process-row"
      className={cn(
        "flex flex-col gap-1 border-b border-border/60 px-3 py-2 text-xs",
        outputOpen && "bg-muted",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ProcessCommand command={row.command} />
        {row.outputPath !== null && (
          <OutputButton
            active={outputOpen}
            onClick={() => onOpenOutput(row.key)}
          />
        )}
      </div>
      <span className="text-muted-foreground">
        {ENDED_BY_LABEL[row.endedBy]} · {timeAgo(row.finishedAt, now)}
      </span>
    </li>
  );
}
