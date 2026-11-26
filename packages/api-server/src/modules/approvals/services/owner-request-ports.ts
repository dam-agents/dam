import {
  describeApprovalPayload,
  gatewayRestartImpact,
  WEB_SEARCH_FOLLOW_UP_QUERIES,
  type ApprovalStatus,
  type ApprovalVerdict,
  type OwnerRoute,
  type PromotionRule,
  type RefusedIn,
} from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { PendingApprovalRow } from "../domain/types.js";
import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";
import type { HoldWaiters } from "./held-verdict.js";

export interface OwnerRequestViewData {
  id: string;
  kind: string;
  status: ApprovalStatus;
  agentId: string;
  ownerSub: string;
  route: OwnerRoute | null;
  summary: string;
  host: string | null;
  expiresAt: string;
  resolvedAt: string | null;
  verdict: ApprovalVerdict | null;
  decidedBy: string | null;
  call: {
    tool: string;
    connectionName: string;
    targetLabel: string | null;
    arguments: string | null;
  } | null;
  network: {
    method: string;
    host: string;
    port: number | null;
    path: string;
    query: string | null;
  } | null;
  search: { query: string | null; followUps: number } | null;
  from: { kind: "environment"; name: string } | { kind: "sub-agent" } | null;
  refusedIn: RefusedIn | null;
  timesToday: number;
  restart: { path: boolean; host: boolean };
}

export const WEB_SEARCH_HOST = "web search";

const UNREACHABLE_DECIDER = "system:owner-unreachable";

function summaryOf(row: PendingApprovalRow): string {
  const { payload } = row;
  if (payload.kind === "ext_authz") {
    const host = `${payload.host}${payload.port ? `:${payload.port}` : ""}`;
    return payload.method === "*"
      ? `HTTPS to ${host}`
      : `${payload.method} ${host}${payload.path}`;
  }
  const described = describeApprovalPayload(payload);
  return described.subtitle
    ? `${described.title}: ${described.subtitle}`
    : described.title;
}

function callOf(row: PendingApprovalRow): OwnerRequestViewData["call"] {
  const { payload } = row;
  if (payload.kind !== "mcp_tool_call") return null;
  const args = payload.arguments;
  return {
    tool: payload.tool,
    connectionName: payload.connectionName,
    targetLabel: payload.targetLabel ?? null,
    arguments:
      args === undefined
        ? null
        : typeof args === "string"
          ? args
          : JSON.stringify(args, null, 2),
  };
}

function hostOf(row: PendingApprovalRow): string | null {
  if (row.payload.kind === "ext_authz") return row.payload.host;
  return row.payload.kind === "web_search" ? WEB_SEARCH_HOST : null;
}

function networkOf(row: PendingApprovalRow): OwnerRequestViewData["network"] {
  if (row.payload.kind !== "ext_authz") return null;
  const { method, host, port, path } = row.payload;
  const mark = path.indexOf("?");
  return {
    method,
    host,
    port: port ?? null,
    path: mark < 0 ? path : path.slice(0, mark),
    query: mark < 0 ? null : path.slice(mark),
  };
}

function fromOf(row: PendingApprovalRow): OwnerRequestViewData["from"] {
  const { payload } = row;
  if (
    payload.kind !== "ext_authz" &&
    payload.kind !== "web_search" &&
    payload.kind !== "mcp_tool_call"
  )
    return null;
  if (payload.viaEnvironment)
    return { kind: "environment", name: payload.viaEnvironment };
  return payload.forAgentId ? { kind: "sub-agent" } : null;
}

function refusedInOf(row: PendingApprovalRow): RefusedIn | null {
  const { payload } = row;
  return (payload.kind === "ext_authz" || payload.kind === "web_search") &&
    payload.refusedIn
    ? payload.refusedIn
    : null;
}

function startOfDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: what the approvals module gives the Slack cards of owner requests: a view of one routed request in the platform's own words, the refusal of a `turn` request whose card cannot reach its owner (denied as the system, so the thread does not wait for a card that never comes), whether any held request still waits for an answer, and the routed requests that still wait, bounded by age, for the sweep.
export function createOwnerRequestPorts(deps: {
  repo: Pick<
    ApprovalsRepository,
    "getPending" | "resolvePending" | "countSince" | "listPendingRouted"
  >;
  waiters: HoldWaiters;
  promotionRulesOf: (
    agentId: string,
  ) => Promise<readonly (PromotionRule & { id: string })[]>;
}) {
  async function restartOf(
    row: PendingApprovalRow,
  ): Promise<OwnerRequestViewData["restart"]> {
    if (row.payload.kind !== "ext_authz") return { path: false, host: false };
    const { host, port, method, path } = row.payload;
    const current = await deps.promotionRulesOf(row.agentId).catch(() => []);
    const restarts = (rule: Omit<PromotionRule, "source">) =>
      gatewayRestartImpact({
        current,
        adds: [{ ...rule, ...(port ? { port } : {}), source: "inbox" }],
      }).willRestart;
    return {
      path: restarts({ host, method, pathPattern: path }),
      host: restarts({ host, method: "*", pathPattern: "*" }),
    };
  }

  async function timesTodayOf(row: PendingApprovalRow): Promise<number> {
    if (row.type !== "ext_authz" && row.type !== "web_search") return 0;
    return deps.repo
      .countSince({
        agentId: row.agentId,
        type: row.type,
        host: row.payload.kind === "ext_authz" ? row.payload.host : null,
        since: startOfDay(new Date()),
      })
      .catch(() => 0);
  }

  return {
    async view(id: string): Promise<OwnerRequestViewData | null> {
      const row = await deps.repo.getPending(id);
      if (!row) return null;
      return {
        id: row.id,
        kind: row.type,
        status: row.status,
        agentId: row.agentId,
        ownerSub: row.ownerSub,
        route: row.ownerRoute ?? null,
        summary: summaryOf(row),
        host: hostOf(row),
        expiresAt: row.expiresAt.toISOString(),
        resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
        verdict: row.verdict,
        decidedBy: row.decidedBy,
        call: callOf(row),
        network: networkOf(row),
        search:
          row.payload.kind === "web_search"
            ? {
                query: row.payload.query,
                followUps: WEB_SEARCH_FOLLOW_UP_QUERIES,
              }
            : null,
        from: fromOf(row),
        refusedIn: refusedInOf(row),
        timesToday: await timesTodayOf(row),
        restart: await restartOf(row),
      };
    },

    async refuseUnreachable(id: string): Promise<boolean> {
      const row = await deps.repo.getPending(id);
      if (!row || row.status !== "pending") return false;
      const denied = await deps.repo.resolvePending(
        id,
        "deny_once",
        UNREACHABLE_DECIDER,
      );
      if (!denied) return false;
      emit({
        type: EventType.ApprovalResolved,
        approvalId: id,
        agentId: row.agentId,
        ownerSub: row.ownerSub,
        resolution: "deny_once",
        ...(row.ownerRoute ? { ownerRoute: row.ownerRoute } : {}),
      });
      securityLog("warn", "egress.decision", {
        category: "egress",
        actor: row.ownerSub,
        actorKind: "system",
        surface: "slack",
        agentId: row.agentId,
        decision: "deny",
        correlationId: id,
        reason: "owner-unreachable",
      });
      return true;
    },

    async anyoneWaits(id: string): Promise<boolean> {
      return (await deps.waiters.count(id)) > 0;
    },

    waiting(input: { since: Date; limit: number }): Promise<string[]> {
      return deps.repo.listPendingRouted(input);
    },
  };
}

export type OwnerRequestPorts = ReturnType<typeof createOwnerRequestPorts>;
