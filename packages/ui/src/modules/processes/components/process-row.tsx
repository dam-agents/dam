import type { ProcessRow as ProcessRowData } from "agent-runtime-api";

import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import { BACKGROUND_KIND_LABEL } from "../lib/process-copy.js";
import { ProcessActionsMenu } from "./process-actions-menu.js";
import { ProcessCommand } from "./process-command.js";
import { ProcessStats } from "./process-stats.js";

interface Props {
  agentId: string;
  row: ProcessRowData;
  alwaysOn: boolean;
  now: Date;
  outputOpen: boolean;
  onOpenOutput: (key: string) => void;
}

export function ProcessRow({
  agentId,
  row,
  alwaysOn,
  now,
  outputOpen,
  onOpenOutput,
}: Props) {
  const hasOutput = row.outputPath !== null;
  const toggleOutput = () => onOpenOutput(row.key);

  return (
    <li
      data-testid="process-row"
      aria-pressed={hasOutput ? outputOpen : undefined}
      className={cn(
        "group flex items-center gap-2 border-b border-border py-2.5 pl-4 pr-2 transition-colors",
        hasOutput && "cursor-pointer",
        outputOpen ? "bg-muted" : hasOutput && "hover:bg-muted/60",
      )}
      {...clickableProps(hasOutput ? toggleOutput : undefined)}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-success motion-safe:animate-pulse"
          />
          <ProcessCommand command={row.command} />
        </div>
        <span className="truncate text-[11px] text-muted-foreground">
          {row.kind !== "turn" && `${BACKGROUND_KIND_LABEL[row.kind]} · `}
          <ProcessStats row={row} now={now} />
        </span>
      </div>
      <ProcessActionsMenu
        agentId={agentId}
        row={row}
        alwaysOn={alwaysOn}
        outputOpen={outputOpen}
        onToggleOutput={toggleOutput}
      />
    </li>
  );
}
