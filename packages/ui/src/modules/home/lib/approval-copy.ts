import type { ApprovalView } from "api-server-api";

export function approvalHeadline(approval: ApprovalView): string {
  return approval.payload.kind === "ext_authz"
    ? "Wants to access network"
    : "Wants to run a command";
}

export function approvalDetail(approval: ApprovalView): string {
  const payload = approval.payload;
  if (payload.kind !== "ext_authz") return payload.toolName;
  const target =
    payload.path === "*"
      ? `${payload.host} (any path)`
      : `${payload.host}${payload.path}`;
  return payload.method === "*" ? target : `${payload.method} ${target}`;
}

export function approvalsBannerCopy(
  approvals: readonly { agentId: string }[],
): { title: string; detail: string } {
  const count = approvals.length;
  const agents = new Set(approvals.map((a) => a.agentId)).size;
  return {
    title: `${String(count)} ${count === 1 ? "approval" : "approvals"} waiting`,
    detail:
      agents === 1
        ? "An agent needs your decision"
        : `${String(agents)} agents need your decision`,
  };
}
