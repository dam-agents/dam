import { Settings, WarningAlt } from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";
import {
  Check,
  CheckCheck,
  ChevronDown,
  Globe,
  ShieldOff,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function useCountdown(expiresAt: string): number | null {
  const [remaining, setRemaining] = useState<number | null>(() => {
    const ms = Date.parse(expiresAt) - Date.now();
    return ms > 0 ? Math.ceil(ms / 1000) : null;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const ms = Date.parse(expiresAt) - Date.now();
      setRemaining(ms > 0 ? Math.ceil(ms / 1000) : null);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}

export function ApprovalCard({ row }: { row: ApprovalView }) {
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const agentName = useAgentDisplayName(row.agentId);

  const live = isHeldCallStillLive(row);
  const countdown = useCountdown(row.expiresAt);
  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;

  const isNetwork = row.payload.kind === "ext_authz";
  const host = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const method = row.payload.kind === "ext_authz" ? row.payload.method : null;
  const path = row.payload.kind === "ext_authz" ? row.payload.path : null;
  const toolName =
    row.payload.kind === "acp_native" ? row.payload.toolName : null;
  const toolArgs =
    row.payload.kind === "acp_native" ? row.payload.args : undefined;

  return (
    <div
      className="rounded-lg border border-border bg-surface p-5 anim-in"
      data-testid="approval-card"
    >
      {/* Header: agent + type badge + timestamp */}
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          className="text-[14px] font-medium text-foreground hover:text-accent transition-colors truncate"
          onClick={() => navigateToSandboxHome(row.agentId)}
          title={`Open ${agentName}`}
        >
          {agentName}
        </button>
        <Badge variant={isNetwork ? "info" : "muted"} size="sm">
          {isNetwork ? "Network" : "Tool"}
        </Badge>
        <span className="ml-auto text-[14px] text-muted-foreground shrink-0">
          {formatRelativeTime(row.createdAt)}
        </span>
      </div>

      {/* Request detail */}
      <div className="rounded-md bg-muted/50 px-4 py-3 mb-4">
        {isNetwork ? (
          <div className="space-y-0.5">
            <p className="font-mono text-[14px] font-semibold text-foreground">
              {method} {host}
            </p>
            <p className="font-mono text-[14px] text-muted-foreground truncate">
              {path}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="font-mono text-[14px] font-semibold text-foreground">
              {toolName}
            </p>
            {toolArgs != null && (
              <pre className="font-mono text-[14px] text-muted-foreground overflow-x-auto max-h-[80px]">
                {typeof toolArgs === "string"
                  ? toolArgs
                  : JSON.stringify(toolArgs as object, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Decision actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Allow dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={inflight} data-testid="allow-trigger">
              <Check size={14} />
              Allow
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              disabled={isNetwork ? !live : false}
              onSelect={() => approveOnce.mutate({ id: row.id })}
            >
              <Check size={14} />
              <span>Allow this request</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => approvePermanent.mutate({ id: row.id })}
            >
              <CheckCheck size={14} />
              <span>
                Allow permanently
                <span className="ml-1 text-muted-foreground">
                  — writes a rule
                </span>
              </span>
            </DropdownMenuItem>
            {host && (
              <DropdownMenuItem
                onSelect={() => approveHost.mutate({ id: row.id })}
                className="text-warning"
              >
                <Globe size={14} />
                <span>
                  Allow all of {host}
                  <span className="ml-1 text-muted-foreground">
                    — wildcard rule
                  </span>
                </span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Deny dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              tone="danger"
              size="sm"
              disabled={inflight}
              data-testid="deny-trigger"
            >
              <X size={14} />
              Deny
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              disabled={!live}
              onSelect={() => dismiss.mutate({ id: row.id })}
            >
              <X size={14} />
              <span>Deny this request</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              tone="danger"
              onSelect={() => denyForever.mutate({ id: row.id })}
            >
              <ShieldOff size={14} />
              <span>
                Deny permanently
                <span className="ml-1 text-muted-foreground">
                  — writes a rule
                </span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Settings shortcut */}
        {isNetwork && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateToSandboxHome(row.agentId)}
            title="Open sandbox network settings"
          >
            <Settings size={16} />
          </Button>
        )}
      </div>

      {/* Expiry countdown */}
      {countdown !== null && countdown <= 30 && (
        <div className="flex items-center gap-1 text-[14px] text-warning mt-3">
          <WarningAlt size={14} />
          <span>Expires in {countdown}s</span>
        </div>
      )}
      {countdown === null && row.status === "pending" && isNetwork && (
        <p className="text-[14px] text-muted-foreground mt-3">
          Original request timed out. Permanent rules still apply to future
          attempts.
        </p>
      )}
    </div>
  );
}
