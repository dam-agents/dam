import type {
  ApprovalActionOutcome,
  ApprovalVerdict,
  ApprovalView,
  ApprovalsService,
  EgressRuleSource,
} from "api-server-api";
import { TRPCError } from "@trpc/server";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { PendingApprovalRow } from "../domain/types.js";
import { randomUUID } from "node:crypto";
import {
  buildAcpPermissionResponse,
  pickOptionId,
} from "../infrastructure/wrapper-response-frames.js";
import { securityLog } from "../../../core/security-log.js";

export interface ApprovalsNotifier {
  notifyResolved(approvalId: string): Promise<void>;
}

export interface WrittenEgressRule {
  id: string;
  verdict: "allow" | "deny";
  source: EgressRuleSource;
}

export type EgressRuleWriteOutcome =
  | { kind: "inserted"; row: WrittenEgressRule }
  | {
      kind: "duplicate";
      row: WrittenEgressRule;
      tookOwnershipFrom?: EgressRuleSource;
    }
  | { kind: "verdict-clash"; existing: WrittenEgressRule };

export interface EgressRuleWriter {
  insert(input: {
    id: string;
    agentId: string;
    host: string;
    method: string;
    pathPattern: string;
    verdict: "allow" | "deny";
    decidedBy: string;
    source: EgressRuleSource;
  }): Promise<EgressRuleWriteOutcome>;
}

export interface WrapperFrameSender {
  send(agentId: string, frame: string): Promise<void>;
}

export interface CreateApprovalsServiceDeps {
  repo: ApprovalsRepository;
  egressRuleWriter: EgressRuleWriter;
  notifier: ApprovalsNotifier;
  wrapperFrameSender: WrapperFrameSender;
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  ownerSub: string;
  agentBinding: readonly string[] | "*";
}

function matchesBinding(
  binding: readonly string[] | "*",
  agentId: string,
): boolean {
  return binding === "*" || binding.includes(agentId);
}

const NOT_ACTIONABLE: ApprovalActionOutcome = {
  outcome: "not_actionable",
  rule: null,
};

function toView(row: PendingApprovalRow): ApprovalView {
  return {
    id: row.id,
    type: row.type,
    agentId: row.agentId,
    sessionId: row.sessionId,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    verdict: row.verdict,
    status: row.status,
  };
}

async function loadOwned(
  deps: CreateApprovalsServiceDeps,
  id: string,
): Promise<PendingApprovalRow | null> {
  const row = await deps.repo.getPending(id);
  if (!row) return null;
  if (row.ownerSub !== deps.ownerSub) {
    securityLog("warn", "authz.owner_mismatch", {
      category: "authz",
      actor: deps.ownerSub,
      actorKind: "user",
      agentId: row.agentId,
      decision: "deny",
      reason: "not-owner",
      correlationId: id,
      detail: { surface: "approval.verdict" },
    });
    return null;
  }
  if (!matchesBinding(deps.agentBinding, row.agentId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `API key is not bound to agent ${row.agentId}`,
    });
  }
  return row;
}

function verdictConflict(
  deps: CreateApprovalsServiceDeps,
  row: PendingApprovalRow,
  attemptedVerdict: "allow" | "deny",
  ruleFields: Record<string, unknown>,
  existing: WrittenEgressRule,
): TRPCError {
  securityLog("warn", "approval.verdict_conflict", {
    category: "approval",
    actor: deps.ownerSub,
    actorKind: "user",
    agentId: row.agentId,
    decision: "deny",
    correlationId: row.id,
    detail: {
      attemptedVerdict,
      ...ruleFields,
      existingRuleId: existing.id,
      existingVerdict: existing.verdict,
    },
  });
  return new TRPCError({
    code: "CONFLICT",
    message: `an equivalent rule already exists with verdict '${existing.verdict}' — edit the agent's network rules instead`,
  });
}

function auditRuleFields(
  outcome: Exclude<EgressRuleWriteOutcome, { kind: "verdict-clash" }>,
): Record<string, unknown> {
  return {
    ruleWritten: outcome.kind === "inserted",
    ruleId: outcome.row.id,
    ...(outcome.kind === "duplicate" && outcome.tookOwnershipFrom
      ? { takenOverFromSource: outcome.tookOwnershipFrom }
      : {}),
  };
}

function auditVerdict(
  deps: CreateApprovalsServiceDeps,
  row: PendingApprovalRow,
  decision: "allow" | "deny",
  detail: Record<string, unknown>,
): void {
  securityLog("info", "approval.verdict", {
    category: "approval",
    actor: deps.ownerSub,
    actorKind: "user",
    agentId: row.agentId,
    decision,
    correlationId: row.id,
    detail,
  });
}

export function createApprovalsService(
  deps: CreateApprovalsServiceDeps,
): ApprovalsService {
  return {
    async listForOwner(opts) {
      const rows = await deps.repo.listPendingForOwner(deps.ownerSub, opts);
      const visible = rows.filter((r) =>
        matchesBinding(deps.agentBinding, r.agentId),
      );
      return visible.map(toView);
    },

    async listForInstance(agentId, opts) {
      if (!(await deps.isAgentOwnedBy(agentId, deps.ownerSub))) return [];
      const rows = await deps.repo.listPendingForInstance(agentId, opts);
      return rows.filter((r) => r.ownerSub === deps.ownerSub).map(toView);
    },

    async approveOnce(id) {
      const row = await loadOwned(deps, id);
      if (!row || row.status !== "pending") return NOT_ACTIONABLE;
      if (row.type === "ext_authz") {
        const casWon = await deps.repo.resolvePending(
          id,
          "allow_once",
          deps.ownerSub,
        );
        await deps.notifier.notifyResolved(id);
        auditVerdict(deps, row, "allow", {
          verdict: "allow_once",
          ruleWritten: false,
        });
        return casWon ? { outcome: "applied", rule: null } : NOT_ACTIONABLE;
      }
      const casWon = await resolveAndDeliverAcpNative(deps, row, "allow_once");
      return casWon ? { outcome: "applied", rule: null } : NOT_ACTIONABLE;
    },

    async approvePermanent(id) {
      const row = await loadOwned(deps, id);
      if (!row || row.status === "resolved") return NOT_ACTIONABLE;
      if (row.type === "ext_authz" && row.payload.kind === "ext_authz") {
        const rule = {
          host: row.payload.host,
          method: row.payload.method,
          pathPattern: row.payload.path,
          verdict: "allow" as const,
        };
        const written = await deps.egressRuleWriter.insert({
          id: randomUUID(),
          agentId: row.agentId,
          ...rule,
          decidedBy: deps.ownerSub,
          source: "inbox",
        });
        if (written.kind === "verdict-clash") {
          throw verdictConflict(
            deps,
            row,
            "allow",
            {
              host: row.payload.host,
              method: row.payload.method,
              pathPattern: row.payload.path,
            },
            written.existing,
          );
        }
        const casWon = await deps.repo.resolvePending(
          id,
          "allow",
          deps.ownerSub,
        );
        if (!casWon) await deps.repo.resolveExpired(id, "allow", deps.ownerSub);
        await deps.notifier.notifyResolved(id);
        auditVerdict(deps, row, "allow", {
          verdict: "allow",
          ...auditRuleFields(written),
          host: row.payload.host,
          method: row.payload.method,
          pathPattern: row.payload.path,
        });
        return { outcome: casWon ? "applied" : "rule_written_expired", rule };
      }
      const casWon = await resolveAndDeliverAcpNative(deps, row, "allow");
      return casWon ? { outcome: "applied", rule: null } : NOT_ACTIONABLE;
    },

    async approveHost(id) {
      const row = await loadOwned(deps, id);
      if (!row || row.status === "resolved") return NOT_ACTIONABLE;
      if (row.type === "ext_authz" && row.payload.kind === "ext_authz") {
        const rule = {
          host: row.payload.host,
          method: "*",
          pathPattern: "*",
          verdict: "allow" as const,
        };
        const written = await deps.egressRuleWriter.insert({
          id: randomUUID(),
          agentId: row.agentId,
          ...rule,
          decidedBy: deps.ownerSub,
          source: "inbox",
        });
        if (written.kind === "verdict-clash") {
          throw verdictConflict(
            deps,
            row,
            "allow",
            { host: row.payload.host, hostWide: true },
            written.existing,
          );
        }
        const casWon = await deps.repo.resolvePending(
          id,
          "allow",
          deps.ownerSub,
        );
        if (!casWon) await deps.repo.resolveExpired(id, "allow", deps.ownerSub);
        await deps.notifier.notifyResolved(id);
        auditVerdict(deps, row, "allow", {
          verdict: "allow",
          ...auditRuleFields(written),
          host: row.payload.host,
          hostWide: true,
        });
        return { outcome: casWon ? "applied" : "rule_written_expired", rule };
      }
      const casWon = await resolveAndDeliverAcpNative(deps, row, "allow");
      return casWon ? { outcome: "applied", rule: null } : NOT_ACTIONABLE;
    },

    async denyForever(id) {
      const row = await loadOwned(deps, id);
      if (!row || row.status === "resolved") return NOT_ACTIONABLE;
      if (row.type === "ext_authz" && row.payload.kind === "ext_authz") {
        const rule = {
          host: row.payload.host,
          method: row.payload.method,
          pathPattern: row.payload.path,
          verdict: "deny" as const,
        };
        const written = await deps.egressRuleWriter.insert({
          id: randomUUID(),
          agentId: row.agentId,
          ...rule,
          decidedBy: deps.ownerSub,
          source: "inbox",
        });
        if (written.kind === "verdict-clash") {
          throw verdictConflict(
            deps,
            row,
            "deny",
            {
              host: row.payload.host,
              method: row.payload.method,
              pathPattern: row.payload.path,
            },
            written.existing,
          );
        }
        const casWon = await deps.repo.resolvePending(
          id,
          "deny",
          deps.ownerSub,
        );
        if (!casWon) await deps.repo.resolveExpired(id, "deny", deps.ownerSub);
        await deps.notifier.notifyResolved(id);
        auditVerdict(deps, row, "deny", {
          verdict: "deny",
          ...auditRuleFields(written),
          host: row.payload.host,
          method: row.payload.method,
          pathPattern: row.payload.path,
        });
        return { outcome: casWon ? "applied" : "rule_written_expired", rule };
      }
      const casWon = await resolveAndDeliverAcpNative(deps, row, "deny");
      return casWon ? { outcome: "applied", rule: null } : NOT_ACTIONABLE;
    },

    async dismiss(id) {
      const row = await loadOwned(deps, id);
      if (!row || row.status !== "pending") return NOT_ACTIONABLE;
      if (row.type === "ext_authz") {
        const casWon = await deps.repo.resolvePending(
          id,
          "deny_once",
          deps.ownerSub,
        );
        await deps.notifier.notifyResolved(id);
        auditVerdict(deps, row, "deny", {
          verdict: "deny_once",
          ruleWritten: false,
        });
        return casWon ? { outcome: "applied", rule: null } : NOT_ACTIONABLE;
      }
      const casWon = await resolveAndDeliverAcpNative(deps, row, "deny_once");
      return casWon ? { outcome: "applied", rule: null } : NOT_ACTIONABLE;
    },
  };
}

async function resolveAndDeliverAcpNative(
  deps: CreateApprovalsServiceDeps,
  row: PendingApprovalRow,
  verdict: ApprovalVerdict,
): Promise<boolean> {
  if (row.payload.kind !== "acp_native") return false;
  const casWon = await deps.repo.resolvePending(row.id, verdict, deps.ownerSub);
  auditVerdict(deps, row, verdict.startsWith("allow") ? "allow" : "deny", {
    verdict,
    native: true,
  });
  const rpcId = row.payload.rpcId;
  if (rpcId === undefined || rpcId === null) return casWon;
  const optionId = pickOptionId(row.payload.options ?? [], verdict);
  const frame = JSON.stringify(buildAcpPermissionResponse(rpcId, optionId));
  try {
    await deps.wrapperFrameSender.send(row.agentId, frame);
    await deps.repo.markDelivered(row.id);
  } catch {}
  return casWon;
}
