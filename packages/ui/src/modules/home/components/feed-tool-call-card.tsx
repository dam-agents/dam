import type { McpToolCallPayload } from "api-server-api";
import { useState } from "react";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { ToolCallAnswered } from "../../approvals/components/tool-call-answered.js";
import { ToolCallApproval } from "../../approvals/components/tool-call-approval.js";
import { approvalHideHint, isRefusedLabel } from "../lib/approval-copy.js";
import type { FeedApprovalCardProps } from "./feed-approval-card.js";

interface Props extends FeedApprovalCardProps {
  payload: McpToolCallPayload;
}

export function FeedToolCallCard({
  approval,
  payload,
  ids = [approval.id],
  agentName,
  avatarName,
  avatar,
  meta,
  onDismiss,
  resolvedLabel = null,
  onResolved,
}: Props) {
  const [ownResolved, setOwnResolved] = useState<string | null>(null);
  const resolved = resolvedLabel ?? ownResolved;

  function handleAnswered(text: string) {
    setOwnResolved(text);
    onResolved?.(text);
  }

  return (
    <div
      data-testid="feed-approval-card"
      className="group w-full rounded-lg border border-border bg-card/80 p-5 text-left"
    >
      <div className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
        {!resolved && (
          <span className="size-2 shrink-0 rounded-full bg-warning" />
        )}
        {avatarName !== undefined && (
          <AgentAvatar name={avatarName} avatar={avatar} size={20} />
        )}
        <span className="truncate">{agentName}</span>
        <span className="shrink-0">· {meta}</span>
        <button
          type="button"
          onClick={onDismiss}
          title={approvalHideHint(approval)}
          className="ml-auto shrink-0 text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
      {resolved ? (
        <ToolCallAnswered
          answer={{ text: resolved, denied: isRefusedLabel(resolved) }}
        />
      ) : (
        <ToolCallApproval
          approval={approval}
          payload={payload}
          ids={ids}
          agentName={agentName}
          onAnswered={(answer) => handleAnswered(answer.text)}
        />
      )}
    </div>
  );
}
