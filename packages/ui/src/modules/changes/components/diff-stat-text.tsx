import type { DiffStat } from "agent-runtime-api";

import { cn } from "@/lib/utils";

export function DiffStatText({
  stat,
  className,
}: {
  stat: Pick<DiffStat, "additions" | "deletions">;
  className?: string;
}) {
  return (
    <span className={cn("font-mono text-2xs tabular-nums", className)}>
      <span className="text-success">+{stat.additions}</span>{" "}
      <span className="text-danger">−{stat.deletions}</span>
    </span>
  );
}
