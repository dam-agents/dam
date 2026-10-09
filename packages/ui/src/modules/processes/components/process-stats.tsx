import type { ProcessRow } from "agent-runtime-api";

import { cn } from "@/lib/utils";

import {
  formatCpu,
  formatMemory,
  formatRunTime,
} from "../lib/format-process.js";

const BUSY_CPU_PERCENT = 50;

interface Props {
  row: ProcessRow;
  now: Date;
}

export function ProcessStats({ row, now }: Props) {
  const cpu = formatCpu(row.cpuPercent);
  const memory = formatMemory(row.rssBytes);
  const busy = row.cpuPercent !== null && row.cpuPercent >= BUSY_CPU_PERCENT;

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
