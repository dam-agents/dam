import { WarningAlt } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { Badge } from "@/components/ui/badge";

import { accessReach } from "../lib/access-choice.js";
import { FULL_ACCESS_LABEL, fullAccessLine } from "../lib/github-access.js";

type Marked = Pick<
  ConnectionView,
  "id" | "authKind" | "fullAccess" | "accessChoice"
>;

export function FullAccessMark({
  connection,
  status,
  tone = "danger",
}: {
  connection: Marked;
  status?: string;
  tone?: "danger" | "warning";
}) {
  if (!connection.fullAccess) return null;
  const label = connection.accessChoice?.fullAccessLabel ?? FULL_ACCESS_LABEL;
  return (
    <Badge
      variant={tone}
      className="shrink-0 gap-1"
      title={
        connection.accessChoice
          ? `${label} — ${accessReach(connection)}`
          : fullAccessLine(connection)
      }
      data-testid={`connection-full-access-${connection.id}`}
    >
      <WarningAlt size={12} aria-hidden />
      {label}
      {status && ` · ${status}`}
    </Badge>
  );
}
