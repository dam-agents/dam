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
