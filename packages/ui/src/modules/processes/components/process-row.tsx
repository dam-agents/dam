import type { ProcessRow as ProcessRowData } from "agent-runtime-api";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  formatCpu,
  formatMemory,
  formatRunTime,
} from "../lib/format-process.js";
import { keepStatusLabel, PROCESS_KIND_LABEL } from "../lib/process-copy.js";
import { OutputButton } from "./output-button.js";
import { ProcessCommand } from "./process-command.js";

interface Props {
  row: ProcessRowData;
  alwaysOn: boolean;
  now: Date;
  outputOpen: boolean;
  onOpenOutput: (key: string) => void;
}

export function ProcessRow({
  row,
  alwaysOn,
  now,
  outputOpen,
  onOpenOutput,
}: Props) {
  const stats = [
    formatRunTime(row.startedAt, now),
    formatCpu(row.cpuPercent),
    formatMemory(row.rssBytes),
  ].filter((part) => part !== null);

  return (
    <li
      data-testid="process-row"
      className={cn(
        "flex flex-col gap-1 border-b border-border/60 px-3 py-2 text-xs",
        outputOpen && "bg-muted",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="muted" size="sm" className="shrink-0">
          {PROCESS_KIND_LABEL[row.kind]}
        </Badge>
        <ProcessCommand command={row.command} />
        {row.outputPath !== null && (
          <OutputButton
            active={outputOpen}
            onClick={() => onOpenOutput(row.key)}
          />
        )}
      </div>
      <span className="text-muted-foreground tabular-nums">
        {stats.join(" · ")}
      </span>
      <span
        className={cn(
          row.keepsAwake ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {keepStatusLabel(row, alwaysOn)}
      </span>
    </li>
  );
}
