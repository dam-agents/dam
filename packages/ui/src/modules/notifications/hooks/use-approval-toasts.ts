import { useEffect, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useNotifications } from "../api/queries.js";
import { isNeedsYou } from "../lib/notification-types.js";

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
      emitToast({
        kind: "warning",
        message: `${agentName} needs your approval`,
        ttl: 6000,
        action: {
          label: "Review",
          onClick: openApprovals,
        },
      });
    }
  }, [approvalItems, agents, openApprovals]);
}
