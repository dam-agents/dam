import { Close } from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

import { getApiHealthSnapshot, subscribeApiHealth } from "../lib/api-health.js";
import { timeAgo } from "../lib/format-time.js";
import { useAgentsList } from "../modules/agents/api/queries.js";
import { useApprovalsForOwner } from "../modules/approvals/api/queries.js";
import { FeedApprovalCard } from "../modules/home/components/feed-approval-card.js";
import { approvalDismissalKey } from "../modules/home/lib/dismissals.js";
import { useStore } from "../store.js";

const TICK_MS = 60_000;

export function FloatingApprovalsPill() {
  const view = useStore((s) => s.view);
  const agents = useAgentsList();
  const { data } = useApprovalsForOwner();
  const dismissedKeys = useStore((s) => s.dismissedKeys);
  const dismissByKey = useStore((s) => s.dismissByKey);
  const [expanded, setExpanded] = useState(false);
  const now = useNow(TICK_MS);
  const banner =
    useSyncExternalStore(subscribeApiHealth, getApiHealthSnapshot) !==
    "connected";

  const items = useMemo(() => {
    return (data ?? [])
      .filter((a) => a.status === "pending")
      .filter((a) => !dismissedKeys.has(approvalDismissalKey(a)))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [data, dismissedKeys]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const chatSurface = view === "chat" || view === "knowledge-base-chat";

  if (view === "home" || items.length === 0) return null;

  const nameOf = (agentId: string) =>
    agents.find((agent) => agent.id === agentId)?.name ?? agentId;

  return (
    <div
      className={cn(
        "fixed right-[54px] z-nav md:right-[58px]",
        chatSurface && "hidden md:block",
        banner
          ? "bottom-[calc(124px+var(--bottom-bar-inset))] md:bottom-[calc(60px+var(--bottom-bar-inset))]"
          : "bottom-[calc(80px+var(--bottom-bar-inset))] md:bottom-[calc(16px+var(--bottom-bar-inset))]",
      )}
    >
      {expanded ? (
        <div className="absolute right-0 bottom-0 w-[380px] overflow-hidden rounded-xl border border-input bg-background shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-warning" />
              <span className="text-sm font-semibold text-foreground">
                Needs attention
              </span>
              <span className="text-sm text-muted-foreground">
                ({items.length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Close approvals"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Close size={16} />
            </button>
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto p-2">
            {items.map((approval: ApprovalView) => (
              <FeedApprovalCard
                key={approval.id}
                approval={approval}
                agentName={nameOf(approval.agentId)}
                meta={timeAgo(approval.createdAt, now)}
                onDismiss={() => dismissByKey(approvalDismissalKey(approval))}
              />
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex h-[34px] items-center gap-2 rounded-md border border-input bg-background px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-warning text-[11px] font-bold text-warning-light">
            {items.length}
          </span>
          <span className="text-sm font-medium">Needs attention</span>
        </button>
      )}
    </div>
  );
}
