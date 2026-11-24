import type { ApprovalView, McpToolCallPayload } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useNow } from "../../../hooks/use-now.js";
import { useStore } from "../../../store.js";
import { useAgent } from "../../agents/api/queries.js";
import { OwnerConnectionsNote } from "../../agents/components/owner-connections-note.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { ApprovalActionsMenu } from "../../approvals/components/approval-actions-menu.js";
import { ChildRuleRows } from "../../approvals/components/child-rule-rows.js";
import {
  type ToolCallAnswer,
  ToolCallAnswered,
} from "../../approvals/components/tool-call-answered.js";
import { ToolCallApproval } from "../../approvals/components/tool-call-approval.js";
import { useApprovalActions } from "../../approvals/hooks/use-approval-actions.js";
import { useDenyApprovals } from "../../approvals/hooks/use-deny-approvals.js";
import {
  approvalGroupKey,
  groupBy,
} from "../../approvals/lib/group-approvals.js";
import { egressApprovalsWaiting } from "../../approvals/lib/waiting-egress.js";
import {
  approvalDetail,
  approvalPromptTitle,
  approvalReason,
  childRulesGroupCopy,
} from "../../home/lib/approval-copy.js";
import { ChatColumn } from "./chat-column.js";

const EXPIRY_TICK_MS = 15_000;

const CARD_FRAME =
  "rounded-xl border border-border bg-muted/30 px-4 py-3.5 flex flex-col gap-3";

interface AnsweredToolCall {
  agentId: string;
  ids: readonly string[];
  answer: ToolCallAnswer;
}

function QueuedApprovals({
  queued,
  disabled,
  onDenyAll,
}: {
  queued: number;
  disabled: boolean;
  onDenyAll: () => void;
}) {
  if (queued === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
      <span>
        {queued} more approval{queued === 1 ? "" : "s"} waiting
      </span>
      <Button
        variant="link"
        size="inline"
        disabled={disabled}
        onClick={onDenyAll}
        data-testid="deny-all-egress-approvals"
        className="text-2xs"
      >
        Deny all
      </Button>
    </div>
  );
}

function ChatToolCallCard({
  group,
  payload,
  queued,
  waiting,
  denyAll,
  denying,
  onAnswered,
}: {
  group: readonly ApprovalView[];
  payload: McpToolCallPayload;
  queued: number;
  waiting: readonly ApprovalView[];
  denyAll: (approvals: readonly ApprovalView[]) => Promise<boolean>;
  denying: boolean;
  onAnswered: (answer: ToolCallAnswer) => void;
}) {
  const approval = group[0]!;
  const caller = useAgent(approval.agentId);
  const parent = useAgent(payload.forAgentId ?? null);
  return (
    <div data-testid="chat-egress-approval" className={CARD_FRAME}>
      <ToolCallApproval
        approval={approval}
        payload={payload}
        ids={group.map((a) => a.id)}
        agentName={caller?.name ?? parent?.name ?? "The agent"}
        onAnswered={onAnswered}
      />
      <OwnerConnectionsNote agentId={approval.agentId} />
      <QueuedApprovals
        queued={queued}
        disabled={denying}
        onDenyAll={() => void denyAll(waiting)}
      />
    </div>
  );
}

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
  const grouped = childRulesGroupCopy(group);
  const reason = grouped?.reason ?? approvalReason(approval);
  return (
    <div data-testid="chat-egress-approval" className={CARD_FRAME}>
      <div className="flex items-start gap-2 text-sm font-semibold text-foreground">
        <span className="h-2 w-2 rounded-full bg-warning shrink-0 mt-1.5" />
        <span className="min-w-0">{approvalPromptTitle(approval)}</span>
      </div>
      {grouped ? (
        <div className="pl-4">
          <ChildRuleRows approvals={group} />
        </div>
      ) : (
        <div className="pl-4 font-mono text-sm text-muted-foreground break-all">
          {approvalDetail(approval)}
          {group.length > 1 && (
            <span className="font-sans"> · {group.length} requests</span>
          )}
        </div>
      )}
      {reason !== null && (
        <p
          data-testid="chat-egress-proposal-reason"
          className="pl-4 text-sm text-muted-foreground break-words"
        >
          {reason}
        </p>
      )}
      <OwnerConnectionsNote agentId={approval.agentId} className="pl-4" />
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
      <QueuedApprovals
        queued={queued}
        disabled={inflight || denying}
        onDenyAll={() => void denyAll(waiting)}
      />
    </div>
  );
}

function CurrentApprovalCard({
  group,
  queued,
  waiting,
  denyAll,
  denying,
  onToolCallAnswered,
}: {
  group: readonly ApprovalView[];
  queued: number;
  waiting: readonly ApprovalView[];
  denyAll: (approvals: readonly ApprovalView[]) => Promise<boolean>;
  denying: boolean;
  onToolCallAnswered: (answer: ToolCallAnswer) => void;
}) {
  const { payload } = group[0]!;
  return payload.kind === "mcp_tool_call" ? (
    <ChatToolCallCard
      group={group}
      payload={payload}
      queued={queued}
      waiting={waiting}
      denyAll={denyAll}
      denying={denying}
      onAnswered={onToolCallAnswered}
    />
  ) : (
    <EgressApprovalCard
      group={group}
      queued={queued}
      waiting={waiting}
      denyAll={denyAll}
      denying={denying}
    />
  );
}

export function EgressApprovalPrompt() {
  const agentId = useStore((s) => s.selectedAgent);
  const { data: approvals = [] } = useApprovalsForAgent(agentId);
  const now = useNow(EXPIRY_TICK_MS);
  const { denyAll, denying } = useDenyApprovals();
  const [answered, setAnswered] = useState<AnsweredToolCall | null>(null);
  const waiting = agentId
    ? egressApprovalsWaiting(approvals, agentId, now)
    : [];
  const groups = groupBy(waiting, approvalGroupKey);
  const current = groups[0];
  const currentKey = current ? approvalGroupKey(current[0]!) : null;
  const shownAnswer =
    answered?.agentId === agentId &&
    (current === undefined || answered.ids.includes(current[0]!.id))
      ? answered.answer
      : null;
  if (!current && !shownAnswer) return null;

  return (
    <div className="px-4 md:px-8 pt-3">
      <ChatColumn>
        {shownAnswer ? (
          <div data-testid="chat-tool-call-answered" className={CARD_FRAME}>
            <ToolCallAnswered
              answer={shownAnswer}
              onClose={() => setAnswered(null)}
            />
          </div>
        ) : (
          current &&
          currentKey !== null &&
          agentId && (
            <CurrentApprovalCard
              key={currentKey}
              group={current}
              queued={groups.length - 1}
              waiting={waiting}
              denyAll={denyAll}
              denying={denying}
              onToolCallAnswered={(answer) =>
                setAnswered({
                  agentId,
                  ids: current.map((approval) => approval.id),
                  answer,
                })
              }
            />
          )
        )}
      </ChatColumn>
    </div>
  );
}
