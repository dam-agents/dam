import type {
  ApprovalView,
  SpendLimitPayload,
  SpendLimitScope,
} from "api-server-api";
import { match } from "ts-pattern";

import {
  AGENT_LIMIT_NAME,
  allAgentsConnectionLimitName,
  connectionLimitName,
  OWN_LIMIT_NAME,
} from "../../spend/lib/copy.js";
import { formatSpendOf, localResetTime } from "../../spend/lib/format.js";

export function approvalHeadline(approval: ApprovalView): string {
  return match(approval.payload)
    .with({ kind: "ext_authz" }, () => "Wants to access network")
    .with({ kind: "acp_native" }, () => "Wants to run a command")
    .with({ kind: "spend_limit" }, () => "Reached its spend limit")
    .exhaustive();
}

function spendLimitName(
  scope: SpendLimitScope,
  connectionName: (id: string) => string | undefined,
): string {
  return match(scope)
    .with({ kind: "agent" }, () => AGENT_LIMIT_NAME)
    .with({ kind: "owner" }, () => OWN_LIMIT_NAME)
    .with({ kind: "connection" }, ({ connectionId }) =>
      connectionLimitName(connectionName(connectionId) ?? "Provider"),
    )
    .with({ kind: "owner-connection" }, ({ connectionId }) =>
      allAgentsConnectionLimitName(connectionName(connectionId) ?? "provider"),
    )
    .exhaustive();
}

function spendLimitDetail(
  payload: SpendLimitPayload,
  connectionName: (id: string) => string | undefined,
): string {
  const reached = payload.amountMicros * (payload.extensions + 1);
  const stopped = match(payload.scope)
    .with({ kind: "agent" }, () => "Its paid model calls stop")
    .with({ kind: "owner" }, () => "Paid model calls of all your agents stop")
    .with({ kind: "connection" }, () => "Its calls on this provider stop")
    .with(
      { kind: "owner-connection" },
      () => "Calls of all your agents on this provider stop",
    )
    .exhaustive();
  const shared =
    payload.scope.kind === "owner-connection"
      ? " Continue lets all of them go on."
      : "";
  return `${spendLimitName(payload.scope, connectionName)}: ${formatSpendOf(reached, reached, payload.unit)} today. ${stopped} until you continue or the day ends.${shared}`;
}

export function approvalDetail(
  approval: ApprovalView,
  connectionName: (id: string) => string | undefined = () => undefined,
): string {
  const payload = approval.payload;
  if (payload.kind === "spend_limit")
    return spendLimitDetail(payload, connectionName);
  if (payload.kind !== "ext_authz") return payload.toolName;
  const target =
    payload.path === "*"
      ? `${payload.host} (any path)`
      : `${payload.host}${payload.path}`;
  const request =
    payload.method === "*" ? target : `${payload.method} ${target}`;
  return payload.viaEnvironment
    ? `${request}, from its Environment ${payload.viaEnvironment}`
    : request;
}

export function approvalHideHint(approval: ApprovalView): string {
  return approval.payload.kind === "spend_limit"
    ? `Hides this from Home. The question stays open until ${localResetTime(approval.expiresAt)} your time.`
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
