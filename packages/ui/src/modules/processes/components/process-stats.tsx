import { cn } from "@/lib/utils";

import {
  formatCpu,
  formatMemory,
  formatRunTime,
} from "../lib/format-process.js";
import type { ProcessRow } from "../types.js";

const BUSY_CPU_PERCENT = 50;

interface Props {
  row: ProcessRow;
  now: Date;
}

export function ProcessStats({ row, now }: Props) {
  const cpu = formatCpu(row.cpuPercent ?? null);
  const memory = formatMemory(row.rssBytes ?? null);
  const busy =
    row.cpuPercent !== undefined && row.cpuPercent >= BUSY_CPU_PERCENT;

  return (
    <span className="tabular-nums">
      {formatRunTime(row.startedAt, now)}
      {cpu && (
        <>
          {" · "}
          <span className={cn(busy && "text-foreground")}>{cpu}</span>
        </>
      )}
      {memory && ` · ${memory}`}
    </span>
  );
}
