import type { ApprovalView } from "api-server-api";

export function approvalHeadline(approval: ApprovalView): string {
  return approval.payload.kind === "ext_authz"
    ? "Wants to access network"
    : "Wants to run a command";
}

export function approvalDetail(approval: ApprovalView): string {
  const payload = approval.payload;
  return payload.kind === "ext_authz"
    ? `${payload.method} ${payload.host}${payload.path}`
    : payload.toolName;
}
