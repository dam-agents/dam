import { WarningAlt } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { Badge } from "@/components/ui/badge";

import { useToolApprovalOffered } from "../hooks/use-tool-approval-offered.js";
import { FULL_ACCESS_LABEL, fullAccessLine } from "../lib/github-access.js";
import { toolModeMark, toolModeReach } from "../lib/tool-mode.js";

type Marked = Pick<
  ConnectionView,
  "id" | "authKind" | "fullAccess" | "toolAccess"
>;

interface Mark {
  label: string;
  title: string;
  tone: "danger" | "warning";
}

function markOf(connection: Marked, offered: boolean): Mark | null {
  if (connection.fullAccess)
    return {
      label: FULL_ACCESS_LABEL,
      title: fullAccessLine(connection),
      tone: "danger",
    };
  const mark = toolModeMark(connection, offered);
  if (!mark) return null;
  return {
    ...mark,
    title: toolModeReach(connection, offered) ?? mark.label,
  };
}

export function FullAccessMark({
  connection,
  status,
  tone,
}: {
  connection: Marked;
  status?: string;
  tone?: "danger" | "warning";
}) {
  const offered = useToolApprovalOffered();
  const mark = markOf(connection, offered);
  if (!mark) return null;
  return (
    <Badge
      variant={tone ?? mark.tone}
      className="shrink-0 gap-1"
      title={mark.title}
      data-testid={`connection-full-access-${connection.id}`}
    >
      <WarningAlt size={12} aria-hidden />
      {mark.label}
      {status && ` · ${status}`}
    </Badge>
  );
}
