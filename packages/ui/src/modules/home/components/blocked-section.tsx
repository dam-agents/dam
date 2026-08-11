import { useEffect, useMemo, useState } from "react";

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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentDisplayName, useAgentsList } from "../../agents/api/queries.js";
import {
  useApproveHost,
  useApproveOnce,
  useApprovePermanent,
  useDenyForever,
  useDismissApproval,
} from "../../approvals/api/mutations.js";
import { usePendingApprovals } from "../../approvals/api/queries.js";
import { isHeldCallStillLive } from "../../approvals/lib/hold.js";
import {
  type BlockedItem,
  rankBlockedItems,
  useBlockedItems,
} from "../home-blocked-data.js";
import {
  DURATION_TICK_MS,
  SEVERITY_CRITICAL_MS,
  SEVERITY_ELEVATED_MS,
  SEVERITY_HIGH_MS,
} from "../home-thresholds.js";
import { formatDuration } from "../lib/format-time.js";

export type BlockedLayout = "stacked-cards";
export const BLOCKED_LAYOUT_OPTIONS: { value: BlockedLayout; label: string }[] = [
  { value: "stacked-cards", label: "Stacked cards" },
];
export function getBlockedLayout(): BlockedLayout { return "stacked-cards"; }
export function setBlockedLayout(_l: BlockedLayout) { /* no-op */ }
export function subscribeBlockedLayout(cb: () => void) {
  void cb;
  return () => {};
}

type SeverityLevel = "normal" | "elevated" | "high" | "critical";

function getSeverity(blockedAt: string): SeverityLevel {
  const ms = Date.now() - Date.parse(blockedAt);
  if (ms >= SEVERITY_CRITICAL_MS) return "critical";
  if (ms >= SEVERITY_HIGH_MS) return "high";
  if (ms >= SEVERITY_ELEVATED_MS) return "elevated";
  return "normal";
}

function useTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), DURATION_TICK_MS);
    return () => clearInterval(id);
  }, []);
}

type UnifiedItem =
  | { source: "approval"; data: ApprovalView }
  | { source: "error"; data: BlockedItem };

type BlockedFilter = "all" | "network" | "tool" | "error";

const BLOCKED_FILTER_TABS: { value: BlockedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "network", label: "Network" },
  { value: "tool", label: "Tool" },
  { value: "error", label: "Errors" },
];

export function BlockedSection() {
  const setView = useStore((s) => s.setView);
  const agents = useAgentsList();
  const { data: blockedItems } = useBlockedItems();
  const { data: pendingApprovals } = usePendingApprovals();
  const [filter, setFilter] = useState<BlockedFilter>("all");
  const [agentFilter, setAgentFilter] = useState("all");
  useTick();

  const nonApprovalItems = rankBlockedItems(
    (blockedItems ?? []).filter((i) => i.type !== "approval"),
  );

  const unified: UnifiedItem[] = [
    ...pendingApprovals.map((a) => ({ source: "approval" as const, data: a })),
    ...nonApprovalItems.map((i) => ({ source: "error" as const, data: i })),
  ];

  const totalCount = unified.length;

  const filtered = useMemo(() => {
    let items = unified;

    if (agentFilter !== "all") {
      items = items.filter((i) =>
        i.source === "approval" ? i.data.agentId === agentFilter : i.data.agentId === agentFilter,
      );
    }

    if (filter === "network") {
      items = items.filter((i) => i.source === "approval" && i.data.payload.kind === "ext_authz");
    } else if (filter === "tool") {
      items = items.filter((i) => i.source === "approval" && i.data.payload.kind === "acp_native");
    } else if (filter === "error") {
      items = items.filter((i) => i.source === "error");
    }

    return items;
  }, [unified, filter, agentFilter]);

  const agentIds = useMemo(() => {
    const ids = new Set(unified.map((i) => i.source === "approval" ? i.data.agentId : i.data.agentId));
    return [...ids];
  }, [unified]);

  const highestSeverity: SeverityLevel =
    nonApprovalItems.length === 0
      ? pendingApprovals.length > 0 ? "elevated" : "normal"
      : nonApprovalItems.reduce<SeverityLevel>((worst, item) => {
          const s = getSeverity(item.blockedAt);
          const order: SeverityLevel[] = ["normal", "elevated", "high", "critical"];
          return order.indexOf(s) > order.indexOf(worst) ? s : worst;
        }, "normal");

  const badgeColor =
    highestSeverity === "high" || highestSeverity === "critical"
      ? "bg-danger text-white"
      : highestSeverity === "elevated"
        ? "bg-warning text-white"
        : "bg-accent text-white";

  return (
    <section className="space-y-3" aria-label="Blocked">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[18px] font-semibold text-foreground">Blocked</h2>
          {totalCount > 0 && (
            <span
              className={cn(
                "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[14px] font-medium min-w-[24px]",
                badgeColor,
              )}
            >
              {totalCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setView("inbox")}
          className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
        >
          See past decisions
        </button>
      </div>

      {totalCount === 0 && (
        <div className="rounded-lg border border-border bg-card px-6 py-6">
          <p className="text-[14px] text-muted-foreground text-center">
            Nothing blocked. All agents are running clean.
          </p>
        </div>
      )}

      {totalCount > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1 border-b border-border">
              {BLOCKED_FILTER_TABS.map((tab) => {
                const count =
                  tab.value === "all" ? unified.length
                  : tab.value === "network" ? unified.filter((i) => i.source === "approval" && i.data.payload.kind === "ext_authz").length
                  : tab.value === "tool" ? unified.filter((i) => i.source === "approval" && i.data.payload.kind === "acp_native").length
                  : unified.filter((i) => i.source === "error").length;
                if (tab.value !== "all" && count === 0) return null;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setFilter(tab.value)}
                    className={cn(
                      "px-3 py-2 text-[14px] font-medium border-b-2 -mb-px transition-colors",
                      filter === tab.value
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.label}
                    {count > 0 && (
                      <span className="ml-1.5 text-muted-foreground">{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {agentIds.length > 1 && (
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="text-[14px] bg-transparent border border-border rounded-md px-2 py-1 text-foreground"
                aria-label="Filter by agent"
              >
                <option value="all">All agents</option>
                {agentIds.map((id) => (
                  <option key={id} value={id}>
                    {agents.find((a) => a.id === id)?.name ?? id}
                  </option>
                ))}
              </select>
            )}
          </div>

          {filtered.length === 0 ? (
            <p className="text-[14px] text-muted-foreground py-4">
              No items match this filter.
            </p>
          ) : (
            <StackedBlockedCards items={filtered} />
          )}
        </>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Stacked cards layout
   ═══════════════════════════════════════════════════════════════════════════ */

function StackedBlockedCards({ items }: { items: UnifiedItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const current = items[0];
  if (!current) return null;

  const remaining = items.length - 1;

  if (expanded) {
    return (
      <div className="space-y-2">
        {items.map((item) =>
          item.source === "approval" ? (
            <ApprovalFullCard key={item.data.id} row={item.data} />
          ) : (
            <ErrorFullCard key={item.data.id} item={item.data} />
          ),
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={cn("relative", remaining > 0 && "mb-5")}>
        {remaining >= 2 && (
          <div className="absolute -bottom-3 left-3 right-3 h-3 rounded-b-lg border border-t-0 border-border bg-card/40" />
        )}
        {remaining >= 1 && (
          <div className="absolute -bottom-1.5 left-1.5 right-1.5 h-3 rounded-b-lg border border-t-0 border-border bg-card/70" />
        )}
        <div className="relative z-10">
          {current.source === "approval" ? (
            <ApprovalFullCard row={current.data} />
          ) : (
            <ErrorFullCard item={current.data} />
          )}
        </div>
      </div>
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[14px] text-muted-foreground hover:text-foreground transition-colors pt-1"
        >
          +{remaining} more blocked
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Card components
   ═══════════════════════════════════════════════════════════════════════════ */

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

function ApprovalFullCard({ row }: { row: ApprovalView }) {
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
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          className="text-[14px] font-medium text-foreground hover:text-accent transition-colors truncate"
          onClick={() => navigateToSandboxHome(row.agentId)}
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

      <div className="rounded-md bg-muted/50 px-3 py-2 mb-3">
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
          <div className="space-y-0.5">
            <p className="font-mono text-[14px] font-semibold text-foreground">
              {toolName}
            </p>
            {toolArgs != null && (
              <pre className="font-mono text-[14px] text-muted-foreground overflow-x-auto max-h-[60px]">
                {typeof toolArgs === "string"
                  ? toolArgs
                  : JSON.stringify(toolArgs as object, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={inflight}>
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
                <span className="ml-1 text-muted-foreground">— writes a rule</span>
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
                  <span className="ml-1 text-muted-foreground">— wildcard rule</span>
                </span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" tone="danger" size="sm" disabled={inflight}>
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
                <span className="ml-1 text-muted-foreground">— writes a rule</span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {isNetwork && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateToSandboxHome(row.agentId)}
            title="Open agent network settings"
          >
            <Settings size={16} />
          </Button>
        )}
      </div>

      {countdown !== null && countdown <= 30 && (
        <div className="flex items-center gap-1 text-[14px] text-warning mt-3">
          <WarningAlt size={14} />
          <span>Expires in {countdown}s</span>
        </div>
      )}
      {countdown === null && isNetwork && (
        <p className="text-[14px] text-muted-foreground mt-3">
          Original request timed out. Permanent rules still apply to future attempts.
        </p>
      )}
    </div>
  );
}

function ErrorFullCard({ item }: { item: BlockedItem }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const severity = getSeverity(item.blockedAt);
  const blockedMs = Math.max(0, Date.now() - Date.parse(item.blockedAt));

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => navigateToSandboxHome(item.agentId)}
          className="text-[14px] font-medium text-foreground hover:text-accent transition-colors shrink-0"
        >
          {item.agentName}
        </button>
        <span className="text-[14px] text-muted-foreground truncate">
          {item.detail.primary}
        </span>
        <span
          className={cn(
            "ml-auto text-[14px] tabular-nums shrink-0",
            severity === "critical" || severity === "high"
              ? "text-danger"
              : "text-muted-foreground",
          )}
        >
          {formatDuration(blockedMs)}
        </span>
      </div>
      <ErrorActions item={item} />
    </div>
  );
}

function ErrorActions({ item }: { item: BlockedItem }) {
  switch (item.type) {
    case "run_failure":
      return (
        <div className="flex items-center gap-2">
          <Button size="sm">Retry</Button>
          <Button size="sm" variant="outline">Logs</Button>
          <button
            type="button"
            className="text-[14px] text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            Dismiss
          </button>
        </div>
      );

    case "connection_error":
      return (
        <div className="flex items-center gap-2">
          <Button size="sm">Reconnect</Button>
          <Button size="sm" variant="outline">Logs</Button>
          <button
            type="button"
            className="text-[14px] text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            Dismiss
          </button>
        </div>
      );

    case "agent_error":
      return (
        <div className="flex items-center gap-2">
          <Button size="sm">Restart</Button>
          <Button size="sm" variant="outline">Logs</Button>
          <button
            type="button"
            className="text-[14px] text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            Dismiss
          </button>
        </div>
      );

    default:
      return null;
  }
}

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
