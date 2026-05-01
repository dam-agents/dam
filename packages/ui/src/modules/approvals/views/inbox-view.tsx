import { useApprovalsForOwner } from "../api/queries.js";
import { ApprovalsList } from "../components/approvals-list.js";

const EMPTY: never[] = [];

export function InboxView() {
  const { data: rows = EMPTY, isLoading } = useApprovalsForOwner();
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[20px] font-extrabold tracking-[-0.02em] text-text">Inbox</h1>
        <span className="text-[11px] text-text-muted">
          {isLoading ? "loading…" : `${pendingCount} pending`}
        </span>
      </div>
      <p className="text-[12px] text-text-muted leading-relaxed max-w-prose">
        Decisions your agents are waiting on. Allowing permanently writes a
        network access rule for the agent so future requests of the same shape
        don't prompt again.
      </p>
      <div className="rounded-lg border border-border-light bg-surface overflow-hidden">
        <ApprovalsList rows={rows} density="full" emptyLabel="Nothing pending" />
      </div>
    </div>
  );
}
