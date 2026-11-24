import type { ApprovalView, McpToolCallPayload } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { DisclosureToggle } from "@/components/ui/disclosure";

import {
  type ApprovalAction,
  useApprovalActions,
} from "../hooks/use-approval-actions.js";
import { useToolCallAccount } from "../hooks/use-tool-call-account.js";
import {
  type ToolCallAnswerCopy,
  toolCallCardCopy,
} from "../lib/tool-call-card-copy.js";
import { templateToolCallOf } from "../lib/tool-call-renderers.js";
import type { ToolCallAnswer } from "./tool-call-answered.js";
import { ToolCallDetails } from "./tool-call-details.js";
import { ToolCallHeader } from "./tool-call-header.js";
import { ToolCallView } from "./tool-call-view.js";

interface Props {
  approval: ApprovalView;
  payload: McpToolCallPayload;
  ids: readonly string[];
  agentName: string;
  onAnswered: (answer: ToolCallAnswer) => void;
}

function Stamps({ stamps }: { stamps: readonly string[] }) {
  if (stamps.length === 0) return null;
  return (
    <div data-testid="tool-call-stamps" className="flex flex-wrap gap-1.5">
      {stamps.map((stamp) => (
        <span
          key={stamp}
          className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground"
        >
          {stamp}
        </span>
      ))}
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a held tool call as one card that reads as what it will do, the same in the chat and on Home: who wants to do what where, the account it acts as and the time left before it is refused; a Slack message as Slack will show it, or the arguments as names and values; two buttons that name the action; and the Connection, the exact tool, the raw arguments and the once-only note behind "Details". The answer is approve once or deny once; the card reports the line to show after it through `onAnswered`.
 */
export function ToolCallApproval({
  approval,
  payload,
  ids,
  agentName,
  onAnswered,
}: Props) {
  const { actions, expiredNote } = useApprovalActions(approval, ids);
  const { actor, accountLabel } = useToolCallAccount(approval, payload);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const copy = toolCallCardCopy(payload, { agentName, actor, accountLabel });
  const allow = actions.find((action) => action.id === "allow-once");
  const deny = actions.find((action) => action.id === "dismiss");

  async function handleAnswer(
    action: ApprovalAction,
    answer: ToolCallAnswerCopy,
    denied: boolean,
  ) {
    if (await action.run()) onAnswered({ text: answer.done, denied });
  }

  return (
    <div
      data-testid="tool-call-approval"
      className="flex min-w-0 flex-col gap-3"
    >
      <ToolCallHeader
        agentName={agentName}
        copy={copy}
        iconSlug={templateToolCallOf(payload)?.iconSlug ?? null}
        requests={ids.length}
        expiresAt={approval.status === "pending" ? approval.expiresAt : null}
      />
      <Stamps stamps={copy.stamps} />
      <ToolCallView
        payload={payload}
        status={approval.status}
        sender={accountLabel ?? (actor === "you" ? "You" : actor)}
      />
      {expiredNote && (
        <p className="text-sm text-muted-foreground">{expiredNote}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {allow && (
          <Button
            size="sm"
            disabled={allow.disabled}
            tooltip={allow.tooltip}
            onClick={() => void handleAnswer(allow, copy.allow, false)}
          >
            {copy.allow.label}
          </Button>
        )}
        {deny && (
          <Button
            size="sm"
            variant="outline"
            disabled={deny.disabled}
            tooltip={deny.tooltip}
            onClick={() => void handleAnswer(deny, copy.deny, true)}
          >
            {copy.deny.label}
          </Button>
        )}
        <DisclosureToggle
          open={detailsOpen}
          onToggle={() => setDetailsOpen((open) => !open)}
          testId="tool-call-details-toggle"
          className="ml-auto gap-1 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Details
        </DisclosureToggle>
      </div>
      <Collapse open={detailsOpen}>
        <ToolCallDetails approval={approval} payload={payload} />
      </Collapse>
    </div>
  );
}
