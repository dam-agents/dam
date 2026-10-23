import type { ConnectionStatus } from "api-server-api";

import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_PRESENTATION: Record<
  Exclude<ConnectionStatus, "active">,
  { label: string; variant: BadgeProps["variant"] }
> = {
  pending: { label: "Authorizing…", variant: "muted" },
  expired: { label: "Expired", variant: "danger" },
  disconnected: { label: "Disconnected", variant: "muted" },
};

export function ConnectionStatusBadge({
  status,
}: {
  status: Exclude<ConnectionStatus, "active">;
}) {
  const { label, variant } = STATUS_PRESENTATION[status];
  return <Badge variant={variant}>{label}</Badge>;
}
