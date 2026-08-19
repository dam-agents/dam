import { SettingsAdjust } from "@carbon/icons-react";
import { type ApprovalView, describeApprovalPayload } from "api-server-api";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useAgentDisplayName } from "../../agents/api/queries.js";
import { useApprovalActions } from "../hooks/use-approval-actions.js";

const STATUS_LABEL: Record<ApprovalView["status"], string> = {
  pending: "pending",
  resolved: "resolved",
  expired: "timed out",
};

export interface ApprovalsListProps {
  rows: readonly ApprovalView[];
  density?: "compact" | "full";
  emptyLabel?: string;
}

export function ApprovalsList({
  rows,
  density = "full",
  emptyLabel = "Nothing pending",
}: ApprovalsListProps) {
  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    [rows],
  );
  if (sorted.length === 0) {
    return (
      <p className="px-4 py-5 text-xs text-muted-foreground">{emptyLabel}</p>
    );
  }
  return (
    <ul className="flex flex-col">
      {sorted.map((row) => (
        <ApprovalRow key={row.id} row={row} density={density} />
      ))}
    </ul>
  );
}

function ApprovalRow({
  row,
  density,
}: {
  row: ApprovalView;
  density: "compact" | "full";
}) {
  const agentName = useAgentDisplayName(row.agentId);
  const { actions, inflight, hostLabel, expiredNote, openSettings } =
    useApprovalActions(row);
  const { title, subtitle } = describeApprovalPayload(row.payload);

  return (
    <li className="border-b border-border px-3 py-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">
              {title}
            </span>
            {row.status !== "pending" && (
              <Badge
                size="sm"
                variant="muted"
                className="uppercase tracking-wider"
              >
                {STATUS_LABEL[row.status]}
              </Badge>
            )}
          </div>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate">
              {subtitle}
            </p>
          )}
          {density === "full" && (
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
              agent {agentName}
            </p>
          )}
        </div>
      </div>
      {row.status !== "resolved" && (
        <div className="flex flex-wrap gap-1.5">
          {actions.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              tone={action.danger ? "danger" : undefined}
              size="xs"
              className={action.id === "allow-host" ? "min-w-0 max-w-full" : ""}
              disabled={action.disabled}
              onClick={() => void action.run()}
              tooltip={action.tooltip}
            >
              <action.icon size={11} />
              <span className="truncate">{action.label}</span>
            </Button>
          ))}
          {hostLabel !== null && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={inflight}
              onClick={openSettings}
              tooltip="Open this agent's settings (connections, network access, environment)"
            >
              <SettingsAdjust size={11} /> Customize…
            </Button>
          )}
        </div>
      )}
      {expiredNote && (
        <p className="text-[11px] text-muted-foreground">{expiredNote}</p>
      )}
    </li>
  );
}
