import { Badge, type BadgeProps } from "@/components/ui/badge";

import type { ExperimentStatus } from "../types.js";

const statusVariant: Record<ExperimentStatus, BadgeProps["variant"]> = {
  draft: "secondary",
  running: "info",
  completed: "success",
  stopped: "muted",
};

const statusLabel: Record<ExperimentStatus, string> = {
  draft: "Draft",
  running: "Running",
  completed: "Completed",
  stopped: "Stopped",
};

export function ExperimentStatusBadge({
  status,
}: {
  status: ExperimentStatus;
}) {
  return <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>;
}
