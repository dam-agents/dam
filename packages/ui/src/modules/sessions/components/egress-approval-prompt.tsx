import { OverflowMenuVertical, Settings } from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useNow } from "../../../hooks/use-now.js";
import { useStore } from "../../../store.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { useApprovalActions } from "../../approvals/hooks/use-approval-actions.js";
import { egressApprovalsWaiting } from "../../approvals/lib/waiting-egress.js";
import { approvalDetail } from "../../home/lib/approval-copy.js";
import { CHAT_GUTTER, ChatColumn } from "./chat-column.js";

const EXPIRY_TICK_MS = 15_000;

function EgressApprovalCard({
  approval,
  queued,
}: {
  approval: ApprovalView;
  queued: number;
}) {
  const { actions, inflight, hostLabel, openSettings } =
    useApprovalActions(approval);
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
            className="bg-background h-[26px] text-sm font-medium"
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
            className="bg-background h-[26px] text-sm font-medium"
          >
            {denyOnce.label}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="bg-background h-[26px] px-1.5"
              disabled={inflight}
              aria-label="More approval actions"
            >
              <OverflowMenuVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {rest.map((action) => (
              <DropdownMenuItem
                key={action.id}
                disabled={action.disabled}
                className={action.danger ? "text-destructive" : undefined}
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {queued > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {queued} more request{queued === 1 ? "" : "s"} queued
        </div>
      )}
    </div>
  );
}

export function EgressApprovalPrompt() {
  const agentId = useStore((s) => s.selectedAgent);
  const { data: approvals = [] } = useApprovalsForAgent(agentId);
  const now = useNow(EXPIRY_TICK_MS);
  const waiting = agentId
    ? egressApprovalsWaiting(approvals, agentId, now)
    : [];
  const current = waiting[0];
  if (!current) return null;

  return (
    <div className={`${CHAT_GUTTER} pt-3`}>
      <ChatColumn>
        <EgressApprovalCard
          key={current.id}
          approval={current}
          queued={waiting.length - 1}
        />
      </ChatColumn>
    </div>
  );
}
