import { type ApprovalView, describeApprovalPayload } from "api-server-api";
import { match } from "ts-pattern";

export function approvalHeadline(approval: ApprovalView): string {
  return match(approval.payload)
    .with({ kind: "ext_authz" }, () => "Wants to access network")
    .with({ kind: "acp_native" }, () => "Wants to run a command")
    .with({ kind: "spend_limit" }, () => "Reached its spend limit")
    .exhaustive();
}

export function approvalDetail(approval: ApprovalView): string {
  const payload = approval.payload;
  if (payload.kind === "spend_limit") {
    return describeApprovalPayload(payload).subtitle;
  }
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
