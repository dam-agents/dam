import type { ApprovalView } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useNow } from "../../../hooks/use-now.js";
import { useStore } from "../../../store.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { ApprovalActionsMenu } from "../../approvals/components/approval-actions-menu.js";
import { useApprovalActions } from "../../approvals/hooks/use-approval-actions.js";
import { useDenyApprovals } from "../../approvals/hooks/use-deny-approvals.js";
import {
  approvalGroupKey,
  groupBy,
} from "../../approvals/lib/group-approvals.js";
import { egressApprovalsWaiting } from "../../approvals/lib/waiting-egress.js";
import {
  approvalDetail,
  approvalReason,
} from "../../home/lib/approval-copy.js";
import { ChatColumn } from "./chat-column.js";

const EXPIRY_TICK_MS = 15_000;

function EgressApprovalCard({
  group,
  queued,
  waiting,
  denyAll,
  denying,
}: {
  group: readonly ApprovalView[];
  queued: number;
  waiting: readonly ApprovalView[];
  denyAll: (approvals: readonly ApprovalView[]) => Promise<boolean>;
  denying: boolean;
}) {
  const approval = group[0]!;
  const { actions, primary, inflight, hostLabel, openSettings } =
    useApprovalActions(
      approval,
      group.map((a) => a.id),
    );
  const reason = approvalReason(approval);
  return (
    <div
      data-testid="chat-egress-approval"
      className="rounded-xl border border-border bg-muted/30 px-4 py-3.5 flex flex-col gap-3"
    >
      <div className="flex items-start gap-2 text-sm font-semibold text-foreground">
        <span className="h-2 w-2 rounded-full bg-warning shrink-0 mt-1.5" />
        <span className="min-w-0">
          {reason === null
            ? "Allow network access?"
            : "Allow this network rule?"}
        </span>
      </div>
      <div className="pl-4 font-mono text-sm text-muted-foreground break-all">
        {approvalDetail(approval)}
        {group.length > 1 && (
          <span className="font-sans"> · {group.length} requests</span>
        )}
      </div>
      {reason !== null && (
        <p
          data-testid="chat-egress-proposal-reason"
          className="pl-4 text-sm text-muted-foreground break-words"
        >
          {reason}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ApprovalActionsMenu
          actions={actions}
          inline={[primary, "dismiss"]}
          variant="outline"
          className="bg-background"
          inflight={inflight}
          hostLabel={hostLabel}
          openSettings={openSettings}
          onRun={(action) => void action.run()}
          contentProps={{ align: "start" }}
        />
      </div>
      {queued > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
          <span>
            {queued} more approval{queued === 1 ? "" : "s"} waiting
          </span>
          <Button
            variant="link"
            size="inline"
            disabled={inflight || denying}
            onClick={() => void denyAll(waiting)}
            data-testid="deny-all-egress-approvals"
            className="text-2xs"
          >
            Deny all
          </Button>
        </div>
      )}
    </div>
  );
}

export function EgressApprovalPrompt() {
  const agentId = useStore((s) => s.selectedAgent);
  const { data: approvals = [] } = useApprovalsForAgent(agentId);
  const now = useNow(EXPIRY_TICK_MS);
  const { denyAll, denying } = useDenyApprovals();
  const waiting = agentId
    ? egressApprovalsWaiting(approvals, agentId, now)
    : [];
  const groups = groupBy(waiting, approvalGroupKey);
  const current = groups[0];
  if (!current) return null;

  return (
    <div className="px-4 md:px-8 pt-3">
      <ChatColumn>
        <EgressApprovalCard
          key={approvalGroupKey(current[0]!)}
          group={current}
          queued={groups.length - 1}
          waiting={waiting}
          denyAll={denyAll}
          denying={denying}
        />
      </ChatColumn>
    </div>
  );
}
