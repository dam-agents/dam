import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SideDrawer, SideDrawerHeader } from "@/components/ui/side-drawer";
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
import { useDefaultModelNotices } from "../hooks/use-default-model-notices.js";
import { useDismissals } from "../hooks/use-dismissals.js";
import { useOutageAlerts } from "../hooks/use-outage-alerts.js";
import { useStickyResolved } from "../hooks/use-sticky-resolved.js";
import { FeedApprovalCard } from "./feed-approval-card.js";
import { FeedCardSkeleton } from "./feed-card-skeleton.js";
import { FeedDefaultModelCard } from "./feed-default-model-card.js";
import { FeedOutageAlertCard } from "./feed-outage-alert-card.js";

const MINUTE_MS = 60_000;

function useApprovals() {
  const { items, agents, loadingFeed } = useFeed();
  const { isDismissed, dismiss } = useDismissals();
  const sticky = useStickyResolved();
  const { denyAll, denying } = useDenyApprovals();
  const defaultModels = useDefaultModelNotices();
  const outageAlerts = useOutageAlerts();
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

  return {
    approvals,
    pending,
    groups,
    groupKeyOf,
    agentOf,
    sticky,
    dismiss,
    denyAll,
    denying,
    defaultModels,
    outageAlerts,
    loadingFeed,
    now,
  };
}

type ApprovalsView = ReturnType<typeof useApprovals>;

function DenyAllButton({ view }: { view: ApprovalsView }) {
  if (deniableApprovalIds(view.pending).length === 0) return null;
  return (
    <Button
      variant="link"
      size="inline"
      disabled={view.denying}
      onClick={() => void view.denyAll(view.pending)}
      title="Denies every approval shown here, once each. Nothing is remembered, so an agent asks again if it tries again."
      data-testid="deny-all-approvals"
      className="text-sm"
    >
      Deny all
    </Button>
  );
}

function ApprovalsList({ view }: { view: ApprovalsView }) {
  const { approvals, groups, groupKeyOf, agentOf, sticky, dismiss, now } = view;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      {view.outageAlerts.waiting.length > 0 && (
        <div className="mb-1 flex flex-col gap-1">
          {view.outageAlerts.waiting.map((alert) => (
            <FeedOutageAlertCard
              key={alert.id}
              alert={alert}
              agentOf={agentOf}
              now={now}
              onDismiss={() => view.outageAlerts.dismiss(alert)}
            />
          ))}
        </div>
      )}
      {view.defaultModels.waiting.length > 0 && (
        <div className="mb-1 flex flex-col gap-1">
          {view.defaultModels.waiting.map((notice) => {
            const agent = agentOf(notice.agentId);
            return (
              <FeedDefaultModelCard
                key={notice.id}
                notice={notice}
                agentName={agent?.name ?? notice.agentId}
                avatarName={agent?.name}
                avatar={agent?.avatar}
                onDismiss={() => view.defaultModels.dismiss(notice)}
              />
            );
          })}
        </div>
      )}
      {view.loadingFeed && approvals.length === 0 ? (
        <FeedCardSkeleton rows={3} />
      ) : approvals.length === 0 ? (
        view.defaultModels.waiting.length === 0 &&
        view.outageAlerts.waiting.length === 0 && (
          <EmptyState bordered={false}>No approvals waiting.</EmptyState>
        )
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
  );
}

export function ApprovalsPanel({ className }: { className?: string }) {
  const view = useApprovals();
  return (
    <SidebarSection
      title="Approvals"
      open
      className={className}
      headerRight={<DenyAllButton view={view} />}
    >
      <ApprovalsList view={view} />
    </SidebarSection>
  );
}

export function ApprovalsDrawer({ onClose }: { onClose: () => void }) {
  const view = useApprovals();
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);
  return (
    <SideDrawer
      side="right"
      label="Approvals"
      closing={closing}
      onClose={requestClose}
      onClosed={onClose}
      className="max-w-[520px]"
    >
      <SideDrawerHeader title="Approvals" onClose={requestClose}>
        <DenyAllButton view={view} />
      </SideDrawerHeader>
      <ApprovalsList view={view} />
    </SideDrawer>
  );
}
