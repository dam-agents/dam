import type { ApprovalView, AttentionItem } from "api-server-api";
import { useEffect, useMemo, useState } from "react";

import { usePageVisible } from "../../agents/hooks/use-page-visible.js";
import { useApprovalsForOwner } from "../../approvals/api/queries.js";
import { useAttention } from "../../home/api/queries.js";
import { isUnreadAttention } from "../../home/lib/unread.js";

function arrivalKeys(
  attention: readonly AttentionItem[],
  approvals: readonly ApprovalView[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const session of attention) {
    if (isUnreadAttention(session)) keys.add(`unread:${session.sessionId}`);
    if (!session.working) keys.add(`idle:${session.sessionId}`);
  }
  for (const approval of approvals)
    if (approval.status === "pending") keys.add(`approval:${approval.id}`);
  return keys;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether something arrived while the browser tab
 * was in the background, so the title can say so. A Session that came back
 * from working, one that is now unread, and an approval that started waiting
 * count. What was already in that state when the tab was hidden does not, and
 * it stops counting once it leaves that state: a Session that started a turn
 * after the tab hid has arrived when that turn ends.
 */
export function useBackgroundUnread(): boolean {
  const visible = usePageVisible();
  const attention = useAttention().data?.items;
  const approvals = useApprovalsForOwner().data;
  const ready = attention !== undefined && approvals !== undefined;
  const keys = useMemo(
    () => arrivalKeys(attention ?? [], approvals ?? []),
    [attention, approvals],
  );
  const [atHide, setAtHide] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (!ready) return;
    setAtHide((previous) => {
      if (visible) return null;
      if (previous === null) return keys;
      const kept = [...previous].filter((key) => keys.has(key));
      return kept.length === previous.size ? previous : new Set(kept);
    });
  }, [visible, ready, keys]);

  if (visible || !ready || atHide === null) return false;
  return [...keys].some((key) => !atHide.has(key));
}
