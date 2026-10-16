import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";

import { timeAgo } from "../../../lib/format-time.js";
import { useDenyApprovals } from "../../approvals/hooks/use-deny-approvals.js";
import { deniableApprovalIds } from "../../approvals/lib/deny-all.js";
import {
  approvalGroupKey,
  groupBy,
} from "../../approvals/lib/group-approvals.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useFeed } from "../api/queries.js";
import { useDismissals } from "../hooks/use-dismissals.js";
import { useStickyResolved } from "../hooks/use-sticky-resolved.js";
import { FeedApprovalCard } from "./feed-approval-card.js";
import { FeedCardSkeleton } from "./feed-card-skeleton.js";

const MINUTE_MS = 60_000;

export function ApprovalsPanel({ className }: { className?: string }) {
  const { items, agents, loadingFeed } = useFeed();
  const { isDismissed, dismiss } = useDismissals();
  const sticky = useStickyResolved();
  const { denyAll, denying } = useDenyApprovals();
  const now = useNow(MINUTE_MS);

  const approvals = sticky
    .merge(items)
    .flatMap((item) =>
      item.kind === "approval" && !isDismissed(item) ? [item] : [],
    );
  const pending = approvals.flatMap((item) =>
    sticky.labelFor(item.id) === null ? [item.approval] : [],
  );
  const groupKeyOf = (item: (typeof approvals)[number]) =>
    `${approvalGroupKey(item.approval)}:${sticky.labelFor(item.id) ?? ""}`;
  const groups = groupBy(approvals, groupKeyOf);
  const agentOf = (agentId: string) => agents.find((a) => a.id === agentId);

  return (
    <SidebarSection
      title="Approvals"
      open
      className={className}
      headerRight={
        deniableApprovalIds(pending).length > 0 && (
          <Button
            variant="link"
            size="inline"
            disabled={denying}
            onClick={() => void denyAll(pending)}
            title="Denies every approval shown here, once each. Nothing is remembered, so an agent asks again if it tries again."
            data-testid="deny-all-approvals"
            className="text-sm"
          >
            Deny all
          </Button>
        )
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {loadingFeed && approvals.length === 0 ? (
          <FeedCardSkeleton rows={3} />
        ) : approvals.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No approvals waiting.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {groups.map((group) => {
              const item = group[0]!;
              const agent = agentOf(item.agentId);
              return (
                <FeedApprovalCard
                  key={groupKeyOf(item)}
                  approval={item.approval}
                  ids={group.map((member) => member.approval.id)}
                  agentName={agent?.name ?? item.agentId}
                  avatarName={agent?.name}
                  avatar={agent?.avatar}
                  meta={item.at ? timeAgo(item.at, now) : "—"}
                  onDismiss={() => {
                    group.forEach((member) => sticky.drop(member.id));
                    dismiss(group);
                  }}
                  resolvedLabel={sticky.labelFor(item.id)}
                  onResolved={(label) =>
                    group.forEach((member) => sticky.keep(member, label))
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </SidebarSection>
  );
}
