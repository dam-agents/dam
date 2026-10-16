import {
  approvalGroupKey,
  groupBy,
} from "../../approvals/lib/group-approvals.js";
import { useFeed } from "../api/queries.js";
import type { FeedItem } from "../lib/feed-item.js";
import { useDismissals } from "./use-dismissals.js";

type WaitingApproval = Extract<FeedItem, { kind: "approval" }>;

export function useWaitingApprovals(): WaitingApproval[] {
  const { items } = useFeed();
  const { isDismissed } = useDismissals();
  const waiting = items.filter(
    (item): item is WaitingApproval =>
      item.kind === "approval" && !isDismissed(item),
  );
  return groupBy(waiting, (item) => approvalGroupKey(item.approval)).map(
    (group) => group[0]!,
  );
}
