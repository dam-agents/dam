import { ArrowRight } from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import { useApprovalHistory } from "../../approvals/api/queries.js";

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - Date.parse(dateStr);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getVerdictDisplay(row: ApprovalView): {
  label: string;
  variant: "success" | "danger" | "muted";
} {
  if (row.status === "expired") {
    return { label: "Expired", variant: "muted" };
  }
  if (row.verdict === "allow_once" || row.verdict === "allow") {
    return { label: "Allowed", variant: "success" };
  }
  if (row.verdict === "deny_once" || row.verdict === "deny") {
    return { label: "Denied", variant: "danger" };
  }
  return { label: "Resolved", variant: "muted" };
}

function getScopeLabel(row: ApprovalView): string | null {
  if (row.status === "expired") return null;
  switch (row.verdict) {
    case "allow_once":
    case "deny_once":
      return "Once";
    case "allow":
      return "Permanently";
    case "deny":
      return "Permanently";
    default:
      return null;
  }
}

export function ApprovalHistorySection() {
  const { data: history } = useApprovalHistory();
  const [expanded, setExpanded] = useState(false);

  if (history.length === 0) return null;

  const visible = expanded ? history : history.slice(0, 1);
  const remaining = history.length - 1;

  return (
    <section className="space-y-3" aria-label="Recent decisions">
      <h2 className="text-[18px] font-semibold text-foreground">
        Recent decisions
      </h2>

      {expanded ? (
        <div className="rounded-lg border border-border overflow-hidden">
          {visible.map((row) => (
            <HistoryRow key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <div>
          <div className={cn("relative", remaining > 0 && "mb-5")}>
            {remaining >= 2 && (
              <div className="absolute -bottom-3 left-3 right-3 h-3 rounded-b-lg border border-t-0 border-border bg-card/40" />
            )}
            {remaining >= 1 && (
              <div className="absolute -bottom-1.5 left-1.5 right-1.5 h-3 rounded-b-lg border border-t-0 border-border bg-card/70" />
            )}
            <div className="relative z-10 rounded-lg border border-border overflow-hidden">
              <HistoryRow row={visible[0]!} />
            </div>
          </div>
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-[14px] text-muted-foreground hover:text-foreground transition-colors pt-1"
            >
              +{remaining} more decisions
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function HistoryRow({ row }: { row: ApprovalView }) {
  const agentName = useAgentDisplayName(row.agentId);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const verdict = getVerdictDisplay(row);
  const scope = getScopeLabel(row);
  const hasRule = row.verdict === "allow" || row.verdict === "deny";
  const isNetwork = row.payload.kind === "ext_authz";

  const requestLabel =
    row.payload.kind === "ext_authz"
      ? `${row.payload.method} ${row.payload.host}${row.payload.path}`
      : (row.payload.toolName ?? "tool call");

  const resolvedTime = row.resolvedAt ?? row.createdAt;

  return (
    <div className="border-b border-border-light px-4 py-3 flex flex-col gap-1 last:border-b-0 bg-card">
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <Badge variant={verdict.variant} size="sm">
          {verdict.label}
        </Badge>
        <span className="font-mono text-[14px] text-foreground truncate min-w-0 flex-1">
          {requestLabel}
        </span>
        <span className="text-[14px] text-muted-foreground shrink-0">
          {agentName}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {scope && (
          <span className="text-[14px] text-muted-foreground">{scope}</span>
        )}
        <span className="text-[14px] text-muted-foreground">
          {formatRelativeTime(resolvedTime)}
        </span>
        {hasRule && isNetwork && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => navigateToSandboxHome(row.agentId)}
            title="View network rules for this agent"
          >
            View rule
            <ArrowRight size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
