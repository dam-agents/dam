import { type ApprovalView, describeApprovalPayload } from "api-server-api";
import {
  Check,
  CheckCheck,
  Globe,
  Settings2,
  ShieldOff,
  X,
} from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import {
  useApproveHost,
  useApproveOnce,
  useApprovePermanent,
  useDenyForever,
  useDismissApproval,
} from "../api/mutations.js";

const STATUS_LABEL: Record<ApprovalView["status"], string> = {
  pending: "pending",
  resolved: "resolved",
  expired: "timed out",
};

function isHeldCallStillLive(row: ApprovalView): boolean {
  return (
    row.status === "pending" && new Date(row.expiresAt).getTime() > Date.now()
  );
}

export interface ApprovalsListProps {
  rows: readonly ApprovalView[];
  /** Compact rendering for the dropdown / tray; full rendering for the page. */
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
      <p className="px-4 py-5 text-[12px] text-text-muted">{emptyLabel}</p>
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
  const navigateToSandboxSettings = useStore(
    (s) => s.navigateToSandboxSettings,
  );
  const { title, subtitle } = describeApprovalPayload(row.payload);
  const live = isHeldCallStillLive(row);
  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;
  const expired = row.status === "expired";
  // Allow-once is only meaningful for ext_authz: there's a single in-flight
  // call to release. ACP-native rows don't have a hold to release — the
  // verdict goes back to the harness via wrapper-response either way.
  const allowOnceDisabled = row.type === "ext_authz" ? !live : false;
  // Host-scoped rules and the egress-rules table are ext_authz concepts.
  // Acp-native verdicts are forwarded to the harness, which has its own
  // per-tool rule model — host wildcards don't apply there.
  const hostLabel = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const showHostActions = hostLabel !== null;

  return (
    <li className="border-b border-border-light px-3 py-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-text truncate">
              {title}
            </span>
            {row.status !== "pending" && (
              <span className="text-[10px] uppercase tracking-wider text-text-muted bg-border-light rounded px-1.5 py-0.5">
                {STATUS_LABEL[row.status]}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-[11px] text-text-muted truncate">{subtitle}</p>
          )}
          {density === "full" && (
            <p className="text-[10px] text-text-muted mt-0.5">
              agent {row.agentId}
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
            title={
              allowOnceDisabled
                ? "Original request already failed; pick Allow permanently to allow future retries"
                : "Allow this single request"
            }
          >
            <Check size={11} /> Allow once
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={inflight}
            onClick={() => approvePermanent.mutate({ id: row.id })}
            title="Allow this exact path on this host (writes a rule)"
          >
            <CheckCheck size={11} /> Allow permanently
          </Button>
          {showHostActions && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="min-w-0 max-w-full"
              disabled={inflight}
              onClick={() => approveHost.mutate({ id: row.id })}
              title={`Allow all requests to ${hostLabel} (writes a wildcard rule)`}
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
            title={
              !live
                ? "Original request already failed; nothing to dismiss"
                : "Deny this single request — re-prompts on the next attempt"
            }
          >
            <X size={11} /> Dismiss
          </Button>
          <Button
            type="button"
            variant="outline"
            tone="danger"
            size="xs"
            disabled={inflight}
            onClick={() => denyForever.mutate({ id: row.id })}
            title="Deny this exact path on this host (writes a deny rule)"
          >
            <ShieldOff size={11} /> Deny forever
          </Button>
          {showHostActions && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={inflight}
              onClick={() => navigateToSandboxSettings(row.agentId)}
              title="Open this sandbox's settings (connections, network access, environment)"
            >
              <Settings2 size={11} /> Customize…
            </Button>
          )}
        </div>
      )}
      {expired && row.type === "ext_authz" && (
        <p className="text-[11px] text-text-muted">
          The original request already failed. Allow permanently writes a rule
          that future retries match.
        </p>
      )}
    </li>
  );
}
