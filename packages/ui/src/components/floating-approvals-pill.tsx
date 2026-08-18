import {
  Checkmark,
  Close,
  OverflowMenuVertical,
  Settings,
} from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useAgentDisplayName } from "../modules/agents/api/queries.js";
import {
  useApproveHost,
  useApproveOnce,
  useApprovePermanent,
  useDenyForever,
  useDismissApproval,
} from "../modules/approvals/api/mutations.js";
import { usePendingApprovals } from "../modules/approvals/api/queries.js";
import { useStore } from "../store.js";

export function FloatingApprovalsPill() {
  const view = useStore((s) => s.view);
  const { data: pending = [] } = usePendingApprovals();
  const [expanded, setExpanded] = useState(false);
  const [resolved, setResolved] = useState<Map<string, string>>(new Map());
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const resolveCard = useCallback((id: string, label: string) => {
    setResolved((prev) => new Map([...prev, [id, label]]));
  }, []);

  const dismissResolved = useCallback((id: string) => {
    setDismissing((prev) => new Set([...prev, id]));
    setTimeout(() => {
      setCollapsed((prev) => new Set([...prev, id]));
    }, 200);
  }, []);

  const visibleCount = pending.filter((a) => !collapsed.has(a.id)).length;

  if (view === "home" || pending.length === 0 || visibleCount === 0) return null;

  return (
    <div className="relative">
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[11px] font-bold shrink-0">
            {visibleCount}
          </span>
          <span className="text-[14px] font-medium text-muted-foreground">
            Needs attention
          </span>
        </button>
      ) : (
        <div className="absolute bottom-0 right-0 w-[380px] rounded-xl border border-input bg-background shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-[14px] font-semibold text-foreground">
                Needs attention
              </span>
              <span className="text-[14px] text-muted-foreground">
                ({visibleCount})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Close size={16} />
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2 space-y-2">
            {pending.map((approval) => (
              <div
                key={approval.id}
                className={cn(
                  "transition-all",
                  dismissing.has(approval.id) &&
                    "opacity-0 scale-[0.98] duration-200",
                  collapsed.has(approval.id) &&
                    "max-h-0 overflow-hidden opacity-0 !mt-0 duration-300",
                )}
              >
                {resolved.has(approval.id) ? (
                  <ResolvedPillCard
                    row={approval}
                    resolvedLabel={resolved.get(approval.id)!}
                    onDismiss={() => dismissResolved(approval.id)}
                  />
                ) : (
                  <ApprovalPillCard
                    row={approval}
                    onResolve={(label) => resolveCard(approval.id, label)}
                    onDismiss={() => dismissResolved(approval.id)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalPillCard({
  row,
  onResolve,
  onDismiss,
}: {
  row: ApprovalView;
  onResolve?: (label: string) => void;
  onDismiss?: () => void;
}) {
  const agentName = useAgentDisplayName(row.agentId);
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const isNetwork = row.payload.kind === "ext_authz";
  const host = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const method = row.payload.kind === "ext_authz" ? row.payload.method : null;
  const toolName =
    row.payload.kind === "acp_native" ? row.payload.toolName : null;
  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;

  const act = (action: () => void, label: string) => {
    action();
    onResolve?.(label);
  };

  return (
    <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <span>{agentName}</span>
          </div>
          <p className="text-[15px] font-semibold text-foreground leading-snug">
            {isNetwork ? "Wants to access network" : "Wants to run a command"}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground hover:text-foreground transition-all shrink-0"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
        <span className="font-mono text-[14px] text-muted-foreground truncate">
          {isNetwork ? `${method} ${host}` : toolName}
        </span>
      </div>
      <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
        <span className="text-[14px] text-muted-foreground">just now</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={inflight}
            onClick={() =>
              act(() => approveOnce.mutate({ id: row.id }), "Allowed")
            }
          >
            Allow
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={inflight}
                className="px-2"
              >
                <OverflowMenuVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  act(
                    () => approvePermanent.mutate({ id: row.id }),
                    "Allowed permanently",
                  )
                }
              >
                Allow permanently
              </DropdownMenuItem>
              {isNetwork && host && (
                <DropdownMenuItem
                  onSelect={() =>
                    act(
                      () => approveHost.mutate({ id: row.id }),
                      `Allowed all of ${host}`,
                    )
                  }
                >
                  Allow all of {host}
                </DropdownMenuItem>
              )}
              {!isNetwork && toolName && (
                <DropdownMenuItem
                  onSelect={() =>
                    act(
                      () => approveHost.mutate({ id: row.id }),
                      `Allowed all ${toolName}`,
                    )
                  }
                >
                  Allow all {toolName} commands
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  act(() => dismiss.mutate({ id: row.id }), "Denied")
                }
              >
                Deny this request
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() =>
                  act(
                    () => denyForever.mutate({ id: row.id }),
                    "Denied permanently",
                  )
                }
              >
                Deny permanently
              </DropdownMenuItem>
              <DropdownMenuSeparator className="-mx-1" />
              <DropdownMenuItem
                onSelect={() => navigateToSandboxHome(row.agentId)}
              >
                <Settings size={16} />
                Network settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function ResolvedPillCard({
  row,
  resolvedLabel,
  onDismiss,
}: {
  row: ApprovalView;
  resolvedLabel: string;
  onDismiss?: () => void;
}) {
  const agentName = useAgentDisplayName(row.agentId);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const isNetwork = row.payload.kind === "ext_authz";
  const host = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const method = row.payload.kind === "ext_authz" ? row.payload.method : null;
  const toolName =
    row.payload.kind === "acp_native" ? row.payload.toolName : null;
  const isDeny = resolvedLabel.toLowerCase().includes("denied");

  return (
    <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
            <span>{agentName}</span>
          </div>
          <p className="text-[15px] font-semibold text-foreground leading-snug">
            {isNetwork ? "Wants to access network" : "Wants to run a command"}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground hover:text-foreground transition-all shrink-0"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
        <span className="font-mono text-[14px] text-muted-foreground truncate">
          {isNetwork ? `${method} ${host}` : toolName}
        </span>
      </div>
      <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
        <span className="text-[14px] text-muted-foreground">just now</span>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1 text-[14px]",
              isDeny ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <Checkmark size={16} />
            {resolvedLabel}
          </span>
          <button
            type="button"
            className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={() => navigateToSandboxHome(row.agentId)}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
