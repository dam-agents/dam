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

export const ALL_AGENTS_SUBJECT = "All your agents";

export function countsAllAgents(approval: ApprovalView): boolean {
  return (
    approval.payload.kind === "spend_limit" &&
    (approval.payload.scope.kind === "owner" ||
      approval.payload.scope.kind === "owner-connection")
  );
}

export function approvalHeadline(approval: ApprovalView): string {
  return match(approval.payload)
    .with({ kind: "ext_authz" }, () => "Wants to access network")
    .with({ kind: "acp_native" }, () => "Wants to run a command")
    .with({ kind: "spend_limit" }, () =>
      countsAllAgents(approval)
        ? "Reached your spend limit"
        : "Reached its spend limit",
    )
    .with({ kind: "egress_proposal" }, () => "Proposes a network rule")
    .with(
      { kind: "agent_change" },
      ({ title }) => `Wants to make a change: ${title}`,
    )
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
  if (payload.kind === "acp_native") return payload.toolName;
  if (payload.kind === "agent_change")
    return payload.procedure.replace(/\./g, " · ");
  const target =
    payload.path === "*"
      ? `${payload.host} (any path)`
      : `${payload.host}${payload.path}`;
  const request =
    payload.method === "*" ? target : `${payload.method} ${target}`;
  if (payload.kind === "egress_proposal") return request;
  return payload.viaEnvironment
    ? `${request}, from its Environment ${payload.viaEnvironment}`
    : request;
}

/* UNIT_BOUNDARY_DESCRIPTION: which Agent a held change acts on, resolved from the arguments the change will run with — `id` on an Agent patch, `agentId` on anything scoped — so the owner reads a name rather than an identifier. */
export function agentChangeTarget(
  approval: ApprovalView,
  nameOf: (agentId: string) => string | undefined,
): string | null {
  const payload = approval.payload;
  if (payload.kind !== "agent_change") return null;
  const input = payload.input;
  if (typeof input !== "object" || input === null) return null;
  const { agentId, id } = input as { agentId?: unknown; id?: unknown };
  const target = typeof agentId === "string" ? agentId : id;
  if (typeof target !== "string" || target === "") return null;
  return nameOf(target) ?? target;
}

/* UNIT_BOUNDARY_DESCRIPTION: the arguments in full, pretty-printed for the owner to read field by field; nothing is abbreviated, because a field they cannot see is a field they did not approve. */
export function agentChangeArguments(approval: ApprovalView): string | null {
  return approval.payload.kind === "agent_change"
    ? JSON.stringify(approval.payload.input ?? null, null, 2)
    : null;
}

export function approvalReason(approval: ApprovalView): string | null {
  return approval.payload.kind === "egress_proposal"
    ? approval.payload.reason
    : null;
}

export function approvalHideHint(approval: ApprovalView): string {
  return match(approval.payload.kind)
    .with(
      "spend_limit",
      () =>
        `Hides this from Home. The question stays open until ${localResetTime(approval.expiresAt)} your time.`,
    )
    .with(
      "egress_proposal",
      () =>
        "Hides this from Home. The proposal stays open in the agent's chat.",
    )
    .otherwise(
      () =>
        "Hides this from Home. The request stays pending — resolve it in the session.",
    );
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
