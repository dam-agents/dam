import type { ApprovalView } from "api-server-api";

export function approvalHeadline(approval: ApprovalView): string {
  if (approval.payload.kind === "ext_authz") return "Wants to access network";
  if (approval.payload.kind === "spend_limit") return "Hit a spend limit";
  return "Wants to run a command";
}

export function approvalDetail(approval: ApprovalView): string {
  const payload = approval.payload;
  if (payload.kind === "ext_authz")
    return `${payload.method} ${payload.host}${payload.path}`;
  if (payload.kind === "spend_limit") return "Spend limit reached";
  return payload.toolName;
}
