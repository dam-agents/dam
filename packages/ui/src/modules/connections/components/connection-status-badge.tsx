import type { ConnectionStatus } from "api-server-api";

import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_PRESENTATION: Record<
  ConnectionStatus,
  { label: string; variant: BadgeProps["variant"] }
> = {
  active: { label: "Connected", variant: "success" },
  pending: { label: "Authorizing…", variant: "muted" },
  expired: { label: "Expired", variant: "danger" },
  disconnected: { label: "Disconnected", variant: "muted" },
};

export function ConnectionStatusBadge({
  status,
}: {
  status: ConnectionStatus;
}) {
  const { label, variant } = STATUS_PRESENTATION[status];
  return <Badge variant={variant}>{label}</Badge>;
}
