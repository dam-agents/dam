import type { ApprovalView } from "api-server-api";

export function egressApprovalsWaiting(
  approvals: readonly ApprovalView[],
  agentId: string,
  now: Date,
): ApprovalView[] {
  return approvals
    .filter(
      (a) =>
        a.type === "ext_authz" &&
        a.agentId === agentId &&
        a.status === "pending" &&
        new Date(a.expiresAt).getTime() > now.getTime(),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
