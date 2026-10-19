import { cn } from "@/lib/utils";

import type { RunOutcomeLine } from "../lib/schedule-format.js";

export function OutcomeLines({
  line,
  className,
  title,
}: {
  line: RunOutcomeLine;
  className?: string;
  title?: string;
}) {
  return (
    <div className={cn("space-y-0.5", className)} title={title}>
      {line.lastRunText && (
        <span className="block">{`Last run ${line.lastRunText}`}</span>
      )}
      <span className={cn("block break-words", line.className)}>
        {line.resultText}
      </span>
    </div>
  );
}
