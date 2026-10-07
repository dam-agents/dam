import { useFeed } from "../api/queries.js";
import type { FeedItem } from "../lib/feed-item.js";
import { useDismissals } from "./use-dismissals.js";

type WaitingApproval = Extract<FeedItem, { kind: "approval" }>;

export function useWaitingApprovals(): WaitingApproval[] {
  const { items } = useFeed();
  const { isDismissed } = useDismissals();
  return items.filter(
    (item): item is WaitingApproval =>
      item.kind === "approval" && !isDismissed(item),
  );
}
