import {
  type AcpPermissionOptionKind,
  answerableOption,
  type ApprovalView,
} from "api-server-api";

import type { ApprovalActionId } from "../hooks/use-approval-actions.js";

const OPTION_KIND_OF: Record<ApprovalActionId, AcpPermissionOptionKind> = {
  "allow-once": "allow_once",
  "allow-permanent": "allow_always",
  "allow-host": "allow_always",
  dismiss: "reject_once",
  "deny-forever": "reject_always",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether an approval action can reach the agent as the answer it names. A tool approval is answered with one of the options the agent offered, and the server cancels the tool call when no option of the action's kind exists, so an action the agent did not offer is not shown. Network and spend approvals have no such options, so every action stays.
 */
export function offeredByAgent(
  row: ApprovalView,
  id: ApprovalActionId,
): boolean {
  if (row.payload.kind !== "acp_native") return true;
  return (
    answerableOption(row.payload.options ?? [], OPTION_KIND_OF[id], {
      idsWhole: row.payload.optionsWhole === true,
    }) !== undefined
  );
}
