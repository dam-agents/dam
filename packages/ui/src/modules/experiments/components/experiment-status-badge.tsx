import type { ExperimentStatus } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLES: Record<ExperimentStatus, string> = {
  draft: "bg-muted text-foreground/80",
  running: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  completed: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  stopped: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

export function ExperimentStatusBadge({
  status,
}: {
  status: ExperimentStatus;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn("border-0 font-medium capitalize", STYLES[status])}
    >
      {status}
    </Badge>
  );
}
