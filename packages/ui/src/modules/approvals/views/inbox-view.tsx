import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { useApprovalHistory, usePendingApprovals } from "../api/queries.js";
import { ApprovalCard } from "../components/approval-card.js";
import {
  ApprovalFilters,
  type ApprovalTypeFilter,
  filterApprovals,
  type VerdictFilter,
} from "../components/approval-filters.js";
import { ApprovalHistoryRow } from "../components/approval-history-row.js";

type Tab = "pending" | "history";

export function InboxView() {
  const [tab, setTab] = useState<Tab>("pending");
  const { data: pending, isLoading: pendingLoading } = usePendingApprovals();
  const { data: history, isLoading: historyLoading } = useApprovalHistory();

  const [agentFilter, setAgentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<ApprovalTypeFilter>("all");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("all");

  const pendingCount = pending.length;

  const filteredPending = useMemo(
    () =>
      filterApprovals(pending, agentFilter, typeFilter).sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    [pending, agentFilter, typeFilter],
  );

  const filteredHistory = useMemo(
    () => filterApprovals(history, agentFilter, typeFilter, verdictFilter),
    [history, agentFilter, typeFilter, verdictFilter],
  );

  const activeRows = tab === "pending" ? pending : history;

  return (
    <div>
      <PageHeader
        title="Approvals"
        adornment={
          pendingCount > 0 ? (
            <Badge variant="info">{pendingCount} pending</Badge>
          ) : undefined
        }
        description="Manage access requests from your sandboxes. Permanent decisions write network rules that apply to all future matching requests."
      />

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-border-light mb-6">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "pending"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Pending
          {pendingCount > 0 && (
            <Badge variant="info" size="sm" className="ml-2">
              {pendingCount}
            </Badge>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "history"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          History
        </button>
      </div>

      {/* Filters */}
      <ApprovalFilters
        rows={activeRows}
        agentFilter={agentFilter}
        onAgentFilterChange={setAgentFilter}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        verdictFilter={tab === "history" ? verdictFilter : undefined}
        onVerdictFilterChange={tab === "history" ? setVerdictFilter : undefined}
      />

      {/* Content */}
      {tab === "pending" && (
        <PendingTab rows={filteredPending} isLoading={pendingLoading} />
      )}
      {tab === "history" && (
        <HistoryTab rows={filteredHistory} isLoading={historyLoading} />
      )}
    </div>
  );
}

function PendingTab({
  rows,
  isLoading,
}: {
  rows: ReturnType<typeof filterApprovals>;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-border h-[120px] animate-pulse bg-muted"
          />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <PageEmptyState
        title="No pending approvals"
        message="Sandboxes will request access here when they encounter an action that requires your permission."
        actionLabel="View history"
        onAction={() => {}}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <ApprovalCard key={row.id} row={row} />
      ))}
    </div>
  );
}

function HistoryTab({
  rows,
  isLoading,
}: {
  rows: ReturnType<typeof filterApprovals>;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="border-b border-border-light h-[56px] animate-pulse bg-muted"
          />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <PageEmptyState
        title="No approval history"
        message="Resolved and expired requests will appear here so you can audit past decisions."
        actionLabel="View pending"
        onAction={() => {}}
      />
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {rows.map((row) => (
        <ApprovalHistoryRow key={row.id} row={row} />
      ))}
    </div>
  );
}
