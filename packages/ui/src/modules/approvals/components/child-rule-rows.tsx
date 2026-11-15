import type { ApprovalView } from "api-server-api";

import { Button } from "@/components/ui/button";

import { approvalDetail } from "../../home/lib/approval-copy.js";
import { useApprovalActions } from "../hooks/use-approval-actions.js";

function ChildRuleRow({ approval }: { approval: ApprovalView }) {
  const { actions } = useApprovalActions(approval);
  const allow = actions.find((action) => action.id === "allow-permanent");
  const decline = actions.find((action) => action.id === "dismiss");
  return (
    <li
      data-testid="child-rule-row"
      className="flex min-w-0 items-center gap-2 px-2.5 py-1"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">
        {approvalDetail(approval)}
      </span>
      {allow && (
        <Button
          variant="outline"
          size="xs"
          disabled={allow.disabled}
          tooltip="Allow only this one"
          onClick={() => void allow.run()}
        >
          Allow
        </Button>
      )}
      {decline && (
        <Button
          variant="ghost"
          tone="danger"
          size="xs"
          disabled={decline.disabled}
          tooltip="Decline only this one"
          onClick={() => void decline.run()}
        >
          Decline
        </Button>
      )}
    </li>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the rules one agent asked for on the same sub-agent or Environment, one per line, each with its own Allow and Decline. The card they sit in answers all of them at once; these lines are for an owner who wants some and not others. An answered rule leaves the list when the approvals are read again.
 */
export function ChildRuleRows({
  approvals,
}: {
  approvals: readonly ApprovalView[];
}) {
  return (
    <ul className="divide-y divide-border/50 overflow-hidden rounded-md border border-border/50 bg-muted/40">
      {approvals.map((approval) => (
        <ChildRuleRow key={approval.id} approval={approval} />
      ))}
    </ul>
  );
}
