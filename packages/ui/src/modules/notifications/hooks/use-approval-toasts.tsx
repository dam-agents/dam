import { ShieldAlert } from "@carbon/icons-react";
import { useEffect, useRef } from "react";
import { toast as sonner } from "sonner";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useNotifications } from "../api/queries.js";
import { isNeedsYou } from "../lib/notification-types.js";

function ApprovalToast({
  agentName,
  onReview,
  onDismiss,
}: {
  agentName: string;
  onReview: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/15 dark:bg-warning/20">
        <ShieldAlert size={16} className="text-warning" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {agentName} needs your approval
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 border-warning/30 text-warning hover:bg-warning/10 hover:text-warning"
        onClick={() => {
          onReview();
          onDismiss();
        }}
      >
        Review
      </Button>
    </div>
  );
}

export function fireApprovalToast(agentName: string, onReview: () => void) {
  sonner.custom(
    (id) => (
      <ApprovalToast
        agentName={agentName}
        onReview={onReview}
        onDismiss={() => sonner.dismiss(id)}
      />
    ),
    {
      duration: 6000,
      className:
        "!rounded-2xl !border !border-warning/30 !bg-warning/5 !p-4 dark:!border-warning/20 dark:!bg-warning/10",
    },
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
      fireApprovalToast(agentName, openApprovals);
    }
  }, [approvalItems, agents, openApprovals]);
}
