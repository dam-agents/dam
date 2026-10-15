import { Settings } from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";

import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

import { useNow } from "../../../hooks/use-now.js";
import { useStore } from "../../../store.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { useApprovalActions } from "../../approvals/hooks/use-approval-actions.js";
import { useDenyApprovals } from "../../approvals/hooks/use-deny-approvals.js";
import { egressApprovalsWaiting } from "../../approvals/lib/waiting-egress.js";
import { approvalDetail } from "../../home/lib/approval-copy.js";
import { ChatColumn } from "./chat-column.js";

const EXPIRY_TICK_MS = 15_000;

function EgressApprovalCard({
  approval,
  waiting,
  denyAll,
  denying,
}: {
  approval: ApprovalView;
  waiting: readonly ApprovalView[];
  denyAll: (approvals: readonly ApprovalView[]) => Promise<boolean>;
  denying: boolean;
}) {
  const { actions, inflight, hostLabel, openSettings } =
    useApprovalActions(approval);
  const queued = waiting.length - 1;
  const allowOnce = actions.find((a) => a.id === "allow-once");
  const denyOnce = actions.find((a) => a.id === "dismiss");
  const rest = actions.filter((a) => a !== allowOnce && a !== denyOnce);

  return (
    <div
      data-testid="chat-egress-approval"
      className="rounded-xl border border-border bg-muted/30 px-4 py-3.5 flex flex-col gap-3"
    >
      <div className="flex items-start gap-2 text-sm font-semibold text-foreground">
        <span className="h-2 w-2 rounded-full bg-warning shrink-0 mt-1.5" />
        <span className="min-w-0">Allow network access?</span>
      </div>
      <div className="pl-4 font-mono text-sm text-muted-foreground break-all">
        {approvalDetail(approval)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {allowOnce && (
          <Button
            variant="outline"
            size="sm"
            disabled={allowOnce.disabled}
            tooltip={allowOnce.tooltip}
            onClick={() => void allowOnce.run()}
            className="bg-background"
          >
            {allowOnce.label}
          </Button>
        )}
        {denyOnce && (
          <Button
            variant="outline"
            size="sm"
            disabled={denyOnce.disabled}
            tooltip={denyOnce.tooltip}
            onClick={() => void denyOnce.run()}
            className="bg-background"
          >
            {denyOnce.label}
          </Button>
        )}
        <RowActionsMenu
          label="More approval actions"
          variant="outline"
          className="h-8 w-8 bg-background"
          disabled={inflight}
          contentProps={{ align: "start" }}
        >
          {rest.map((action) => (
            <DropdownMenuItem
              key={action.id}
              disabled={action.disabled}
              tone={action.danger ? "danger" : "default"}
              onSelect={() => void action.run()}
              title={action.tooltip}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
          {hostLabel !== null && (
            <>
              <DropdownMenuSeparator className="-mx-1" />
              <DropdownMenuItem onSelect={openSettings}>
                <Settings size={16} />
                Network settings
              </DropdownMenuItem>
            </>
          )}
        </RowActionsMenu>
      </div>
      {queued > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
          <span>
            {queued} more request{queued === 1 ? "" : "s"} queued
          </span>
          <Button
            variant="link"
            size="inline"
            disabled={inflight || denying}
            onClick={() => void denyAll(waiting)}
            data-testid="deny-all-egress-approvals"
            className="text-2xs"
          >
            Deny all {waiting.length}
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
  const current = waiting[0];
  if (!current) return null;

  return (
    <div className="px-4 md:px-8 pt-3">
      <ChatColumn>
        <EgressApprovalCard
          key={current.id}
          approval={current}
          waiting={waiting}
          denyAll={denyAll}
          denying={denying}
        />
      </ChatColumn>
    </div>
  );
}
