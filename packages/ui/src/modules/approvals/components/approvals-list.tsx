import {
  Checkmark,
  CheckmarkFilled,
  Close,
  Globe,
  Misuse,
  SettingsAdjust,
} from "@carbon/icons-react";
import { type ApprovalView, describeApprovalPayload } from "api-server-api";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import {
  useApproveHost,
  useApproveOnce,
  useApprovePermanent,
  useDenyForever,
  useDismissApproval,
} from "../api/mutations.js";
import { isHeldCallStillLive } from "../lib/hold.js";

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
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const agentName = useAgentDisplayName(row.agentId);
  const { title, subtitle } = describeApprovalPayload(row.payload);
  const live = isHeldCallStillLive(row);
  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;
  const expired = row.status === "expired";
  const allowOnceDisabled = row.type === "ext_authz" ? !live : false;
  const hostLabel = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const showHostActions = hostLabel !== null;

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
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={inflight || allowOnceDisabled}
            onClick={() => approveOnce.mutate({ id: row.id })}
            tooltip={
              allowOnceDisabled
                ? "Original request already failed; pick Allow permanently to allow future retries"
                : undefined
            }
          >
            <Checkmark size={11} /> Allow once
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={inflight}
            onClick={() => approvePermanent.mutate({ id: row.id })}
            tooltip="Allow this exact path on this host (writes a rule)"
          >
            <CheckmarkFilled size={11} /> Allow permanently
          </Button>
          {showHostActions && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="min-w-0 max-w-full"
              disabled={inflight}
              onClick={() => approveHost.mutate({ id: row.id })}
              tooltip={`Allow all requests to ${hostLabel} (writes a wildcard rule)`}
            >
              <Globe size={11} />
              <span className="truncate">Allow {hostLabel}</span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            tone="danger"
            size="xs"
            disabled={inflight || !live}
            onClick={() => dismiss.mutate({ id: row.id })}
            tooltip={
              !live
                ? "Original request already failed; nothing to dismiss"
                : "Deny this single request — re-prompts on the next attempt"
            }
          >
            <Close size={11} /> Dismiss
          </Button>
          <Button
            type="button"
            variant="outline"
            tone="danger"
            size="xs"
            disabled={inflight}
            onClick={() => denyForever.mutate({ id: row.id })}
            tooltip="Deny this exact path on this host (writes a deny rule)"
          >
            <Misuse size={11} /> Deny forever
          </Button>
          {showHostActions && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={inflight}
              onClick={() => navigateToSandboxHome(row.agentId)}
              tooltip="Open this sandbox's settings (connections, network access, environment)"
            >
              <SettingsAdjust size={11} /> Customize…
            </Button>
          )}
        </div>
      )}
      {expired && row.type === "ext_authz" && (
        <p className="text-[11px] text-muted-foreground">
          The original request already failed. Allow permanently writes a rule
          that future retries match.
        </p>
      )}
    </li>
  );
}
