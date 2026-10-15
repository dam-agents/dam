import type {
  ApprovalView,
  SpendLimitPayload,
  SpendLimitScope,
} from "api-server-api";
import { match } from "ts-pattern";

import { formatSpend } from "../../spend/lib/format.js";

const SPEND_LIMIT_NAMES: Record<SpendLimitScope["kind"], string> = {
  agent: "Agent limit",
  owner: "Limit for all your agents",
  connection: "Connection limit",
};

export function approvalHeadline(approval: ApprovalView): string {
  return match(approval.payload)
    .with({ kind: "ext_authz" }, () => "Wants to access network")
    .with({ kind: "acp_native" }, () => "Wants to run a command")
    .with({ kind: "spend_limit" }, () => "Reached its spend limit")
    .exhaustive();
}

function spendLimitDetail(payload: SpendLimitPayload): string {
  const reached = formatSpend(
    payload.amountMicros * (payload.extensions + 1),
    payload.unit,
  );
  const step = formatSpend(payload.amountMicros, payload.unit);
  return `${SPEND_LIMIT_NAMES[payload.scope.kind]}: ${reached} of ${reached} today. Continue adds ${step} for today.`;
}

export function approvalDetail(approval: ApprovalView): string {
  const payload = approval.payload;
  if (payload.kind === "spend_limit") return spendLimitDetail(payload);
  if (payload.kind !== "ext_authz") return payload.toolName;
  const target =
    payload.path === "*"
      ? `${payload.host} (any path)`
      : `${payload.host}${payload.path}`;
  return payload.method === "*" ? target : `${payload.method} ${target}`;
}

export function approvalHideHint(approval: ApprovalView): string {
  return approval.payload.kind === "spend_limit"
    ? "Hides this from Home. The question stays open until midnight UTC."
    : "Hides this from Home. The request stays pending — resolve it in the session.";
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
