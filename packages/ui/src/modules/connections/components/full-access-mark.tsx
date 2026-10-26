import { WarningAlt } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { Badge } from "@/components/ui/badge";

import { FULL_ACCESS_LABEL, fullAccessLine } from "../lib/github-access.js";

export function FullAccessMark({
  connection,
}: {
  connection: Pick<ConnectionView, "id" | "authKind" | "fullAccess">;
}) {
  if (!connection.fullAccess) return null;
  return (
    <Badge
      variant="danger"
      className="shrink-0 gap-1"
      title={fullAccessLine(connection)}
      data-testid={`connection-full-access-${connection.id}`}
    >
      <WarningAlt size={12} aria-hidden />
      {FULL_ACCESS_LABEL}
    </Badge>
  );
}
