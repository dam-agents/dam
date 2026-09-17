import { Warning } from "@carbon/icons-react";
import { useEffect, useRef } from "react";
import { toast as sonner } from "sonner";

import { useStore } from "../../../store.js";
import { useFeed } from "../api/queries.js";
import { approvalHeadline } from "../lib/approval-copy.js";
import type { FeedItem } from "../lib/feed-item.js";

function fireApprovalToast(
  agentName: string,
  headline: string,
  onReview: () => void,
): void {
  sonner.custom(
    (id) => (
      <button
        type="button"
        onClick={() => {
          onReview();
          sonner.dismiss(id);
        }}
        className="flex w-[356px] cursor-pointer items-center gap-3 rounded-lg border border-warning/30 bg-[color-mix(in_srgb,var(--c-warning)_10%,white)] px-4 py-3 text-left shadow-lg transition-colors hover:bg-[color-mix(in_srgb,var(--c-warning)_15%,white)] dark:bg-[var(--c-warning-light)] dark:hover:bg-[color-mix(in_srgb,var(--c-warning)_20%,var(--background))]"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning/10">
          <Warning size={16} className="text-warning" />
        </div>
        <p className="min-w-0 flex-1 text-sm leading-snug">
          <span className="font-semibold text-foreground">{agentName}</span>
          <span className="text-foreground"> {headline.toLowerCase()}</span>
        </p>
      </button>
    ),
    { duration: 6000 },
  );
}

export function useApprovalToasts(): void {
  const { items, agents, loadingFeed } = useFeed();
  const setActivityOpen = useStore((s) => s.setActivityOpen);
  const seen = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (loadingFeed) return;
    const approvals = items.filter(
      (item): item is Extract<FeedItem, { kind: "approval" }> =>
        item.kind === "approval",
    );
    const previous = seen.current;
    seen.current = new Set(approvals.map((item) => item.id));
    if (previous === null) return;

    const names = new Map(agents.map((agent) => [agent.id, agent.name]));
    for (const item of approvals) {
      if (previous.has(item.id)) continue;
      fireApprovalToast(
        names.get(item.agentId) ?? "An agent",
        approvalHeadline(item.approval),
        () => setActivityOpen(true),
      );
    }
  }, [items, agents, loadingFeed, setActivityOpen]);
}
