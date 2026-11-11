import {
  type ApprovalView,
  type SpendLimitPayload,
  type SpendLimitScope,
  WEB_SEARCH_FOLLOW_UP_QUERIES,
  wildcardHostReach,
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

const capitalized = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

// UNIT_BOUNDARY_DESCRIPTION: the agent an approval card names as the one asking. A request for a rule on a sub-agent or Environment is asked by the agent that created it, so the card names that agent and not the child.
export function approvalSubjectId(approval: ApprovalView): string {
  return approval.payload.kind === "egress_proposal" &&
    approval.payload.forAgentId
    ? approval.payload.forAgentId
    : approval.agentId;
}

// UNIT_BOUNDARY_DESCRIPTION: the name a card gives the asking agent: for a request on a sub-agent or Environment, the name its sentence uses, so the two never differ; otherwise the agent's own name.
export function approvalSubjectName(
  approval: ApprovalView,
  nameOf: (agentId: string) => string | undefined,
): string | undefined {
  return (
    (approval.payload.kind === "egress_proposal"
      ? approval.payload.forAgentName
      : undefined) ?? nameOf(approvalSubjectId(approval))
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
    .with({ kind: "egress_proposal" }, (payload) =>
      payload.forAgentId
        ? `Wants more network access for its ${match(payload.forChild)
            .with("sub-agent", undefined, () => "sub-agent")
            .with("environment", () => "Environment")
            .exhaustive()}`
        : "Proposes a network rule",
    )
    .with({ kind: "web_search" }, () => "Wants to search the web")
    .exhaustive();
}

export function approvalPromptTitle(approval: ApprovalView): string {
  return match(approval.payload.kind)
    .with("web_search", () => "Allow this web search?")
    .with("egress_proposal", () => "Allow this network rule?")
    .otherwise(() => "Allow network access?");
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
  if (payload.kind === "web_search") {
    const query = payload.query ?? "The model chooses the query";
    if (payload.viaEnvironment)
      return `${query}, from its Environment ${payload.viaEnvironment}`;
    return payload.forAgentId
      ? `${query}, from its sub-agent ${approval.agentId}`
      : query;
  }
  const target =
    payload.path === "*"
      ? `${payload.host} (any path)`
      : `${payload.host}${payload.path}`;
  const request =
    payload.method === "*" ? target : `${payload.method} ${target}`;
  if (payload.kind === "egress_proposal") {
    if (!payload.forAgentId) return request;
    if (!payload.widerThanDriver)
      return capitalized(wildcardHostReach(payload.host));
    const asked =
      payload.path === "*" ? payload.host : `${payload.host}${payload.path}`;
    return payload.method === "*" ? asked : `${payload.method} ${asked}`;
  }
  if (payload.viaEnvironment)
    return `${request}, from its Environment ${payload.viaEnvironment}`;
  return payload.forAgentId
    ? `${request}, from its sub-agent ${approval.agentId}`
    : request;
}

export const WEB_SEARCH_FOLLOW_UP_NOTE = `If you allow it, the search can also run up to ${String(WEB_SEARCH_FOLLOW_UP_QUERIES)} more queries that the model writes after it reads the first results.`;

// UNIT_BOUNDARY_DESCRIPTION: what a card says when it stands for several rules one agent asked for on the same sub-agent or Environment, as one launch often does: one sentence for all of them, above the rules listed one per line, so the owner can answer the launch once or rule by rule. Null for a single request, which keeps its own line and sentence.
export function childRulesGroupCopy(
  group: readonly ApprovalView[],
): { reason: string } | null {
  const first = group[0]?.payload;
  if (group.length < 2 || first?.kind !== "egress_proposal") return null;
  if (!first.forAgentId) return null;
  const child = `${first.forChild === "environment" ? "Environment" : "sub-agent"}${first.forChildName ? ` ${first.forChildName}` : ""}`;
  const who = first.forAgentName ?? "The agent";
  return {
    reason: first.widerThanDriver
      ? `${who} wants its ${child} to reach these ${String(group.length)}. ${who}'s own network rules do not allow them.`
      : `${who} wants its ${child} to reach these ${String(group.length)} groups of hosts.`,
  };
}

export function approvalReason(approval: ApprovalView): string | null {
  return match(approval.payload)
    .with({ kind: "egress_proposal" }, (payload) => payload.reason)
    .with({ kind: "web_search" }, () => WEB_SEARCH_FOLLOW_UP_NOTE)
    .otherwise(() => null);
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
    .with(
      "web_search",
      () =>
        "Hides this from Home. The search stays held until you answer it in the agent's chat or the hold ends.",
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
