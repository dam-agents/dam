import { Badge, type BadgeProps } from "@/components/ui/badge";

import type { ArmStatus } from "../types.js";

const statusVariant: Record<ArmStatus, BadgeProps["variant"]> = {
  pending: "secondary",
  running: "info",
  completed: "success",
  failed: "danger",
  stopped: "muted",
};

const statusLabel: Record<ArmStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

export function ArmStatusBadge({ status }: { status: ArmStatus }) {
  return <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>;
}
