import { Warning } from "@carbon/icons-react";
import { useEffect, useRef } from "react";
import { toast as sonner } from "sonner";

import { useStore } from "../../../store.js";
import { useNotifications } from "../api/queries.js";
import { approvalHeadline } from "../lib/approval-copy.js";
import { isNeedsYou } from "../lib/notification-types.js";
import type { NotificationItem } from "../lib/notification-types.js";

export function fireApprovalToast(
  agentName: string,
  headline: string,
  onReview: () => void,
) {
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
          <span className="text-foreground">
            {" "}
            {headline.toLowerCase()}
          </span>
        </p>
      </button>
    ),
    { duration: 6000 },
  );
}

export function useApprovalToasts() {
  const { items, agents } = useNotifications();
  const openApprovals = useStore((s) => s.openApprovals);
  const seenIds = useRef(new Set<string>());

  const approvalItems = items.filter(isNeedsYou);

  useEffect(() => {
    if (seenIds.current.size === 0 && approvalItems.length > 0) {
      for (const item of approvalItems) {
        seenIds.current.add(item.id);
      }
      return;
    }

    const agentMap = new Map(agents.map((a) => [a.id, a.name]));

    for (const item of approvalItems) {
      if (seenIds.current.has(item.id)) continue;
      seenIds.current.add(item.id);

      const agentName = agentMap.get(item.agentId) ?? "An agent";
      const headline = approvalHeadline(
        (item as Extract<NotificationItem, { type: "approval-tool" }>).approval,
      );
      fireApprovalToast(agentName, headline, openApprovals);
    }
  }, [approvalItems, agents, openApprovals]);
}
