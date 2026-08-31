import { ArrowLeft } from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { clockOf } from "@/lib/format-time";

import type { AgentView } from "../../../types.js";
import { FeedApprovalCard } from "./feed-approval-card.js";

interface Props {
  approvals: readonly ApprovalView[];
  agents: readonly AgentView[];
  dismissed: ReadonlySet<string>;
  onDismiss: (key: string) => void;
  onBack: () => void;
  resolvedLabelFor: (id: string) => string | null;
  onResolved: (id: string, label: string) => void;
}

export function ApprovalsDetailPage({
  approvals,
  agents,
  dismissed,
  onDismiss,
  onBack,
  resolvedLabelFor,
  onResolved,
}: Props) {
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const visible = approvals.filter(
    (a) => !dismissed.has(`approval:${a.id}:${a.createdAt}`),
  );
  const pending = visible.filter((a) => a.status === "pending");
  const expired = visible.filter((a) => a.status === "expired");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 py-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back to activity"
          data-testid="approvals-back"
          className="shrink-0 text-muted-foreground"
        >
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h3 className="text-[15px] font-semibold text-foreground">
            Approvals
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pending.length} pending
            {expired.length > 0 && `, ${expired.length} expired`}
          </p>
        </div>
      </div>

      {pending.length === 0 && expired.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          All approvals have been dismissed or resolved.
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex flex-col gap-3">
          {pending.map((approval) => (
            <FeedApprovalCard
              key={approval.id}
              approval={approval}
              agentName={
                agentMap.get(approval.agentId)?.name ?? approval.agentId
              }
              meta={clockOf(approval.createdAt)}
              onDismiss={() =>
                onDismiss(`approval:${approval.id}:${approval.createdAt}`)
              }
              resolvedLabel={resolvedLabelFor(approval.id)}
              onResolved={(label) => onResolved(approval.id, label)}
            />
          ))}
        </div>
      )}

      {expired.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Expired
          </p>
          {expired.map((approval) => (
            <FeedApprovalCard
              key={approval.id}
              approval={approval}
              agentName={
                agentMap.get(approval.agentId)?.name ?? approval.agentId
              }
              meta={clockOf(approval.createdAt)}
              onDismiss={() =>
                onDismiss(`approval:${approval.id}:${approval.createdAt}`)
              }
              resolvedLabel={resolvedLabelFor(approval.id)}
              onResolved={(label) => onResolved(approval.id, label)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
