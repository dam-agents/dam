import type {
  ApprovalActionOutcome,
  ApprovalVerdict,
  ApprovalView,
  ApprovalsService,
  EgressRuleSource,
} from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { PendingApprovalRow } from "../domain/types.js";
import { randomUUID } from "node:crypto";
import {
  buildAcpPermissionResponse,
  pickOptionId,
} from "../infrastructure/wrapper-response-frames.js";
import { securityLog } from "../../../core/security-log.js";

/** Notifier for cross-replica wake-up of held ext_authz calls. Publishes to
 *  `approval:<id>` on Redis; consumers read the verdict from Postgres. The
 *  service does not care whether anyone is listening — Postgres is the truth. */
export interface ApprovalsNotifier {
  notifyResolved(approvalId: string): Promise<void>;
}

/** Narrow port the approvals service consumes for the
 *  approve-permanent / deny-forever paths. The egress-rules module's
 *  `compose.ts` provides an adapter; the approvals service never sees the
 *  full `EgressRulesRepository`. */
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
  }): Promise<void>;
}

/** Outbox port: opens a one-shot WS to the wrapper and sends a JSON-RPC
 *  response frame. Used inline on inbox resolve so delivery happens on the
 *  click-handling replica without any Redis hop. The periodic sweep retries
 *  rows whose `delivered_at` is still null (e.g. replica died mid-send). */
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
    // A caller acting on an approval that isn't theirs — cross-tenant
    // approval-tampering attempt.
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
  return row;
}

/** One audit line per HITL verdict. correlationId === the pending-approval id,
 *  which is the same id the ext_authz gate logs on hold-open / hold-resolve —
 *  so the held request and the human decision join on it. */
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
      return rows.map(toView);
    },

    async listForInstance(agentId, opts) {
      if (!(await deps.isAgentOwnedBy(agentId, deps.ownerSub))) return [];
      const rows = await deps.repo.listPendingForInstance(agentId, opts);
      // Defense-in-depth: filter to caller's own rows even though instance
      // ownership already implies it.
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
        await deps.egressRuleWriter.insert({
          id: randomUUID(),
          agentId: row.agentId,
          ...rule,
          decidedBy: deps.ownerSub,
          source: "inbox",
        });
        // The pending row may already be expired (the held call timed out),
        // in which case resolvePending no-ops — that's the timed-out
        // approve-permanent flow: rule is written, future retries match.
        const casWon = await deps.repo.resolvePending(
          id,
          "allow",
          deps.ownerSub,
        );
        await deps.notifier.notifyResolved(id);
        auditVerdict(deps, row, "allow", {
          verdict: "allow",
          ruleWritten: true,
          host: row.payload.host,
          method: row.payload.method,
          pathPattern: row.payload.path,
        });
        return { outcome: casWon ? "applied" : "rule_written_expired", rule };
      }
      // ACP-native: persistence ("allow_always") is the harness's own
      // concern — Claude Code / Codex maintain their own permission rules
      // via the option's kind. We just send the verdict; the harness
      // remembers it.
      const casWon = await resolveAndDeliverAcpNative(deps, row, "allow");
      return casWon ? { outcome: "applied", rule: null } : NOT_ACTIONABLE;
    },

    async approveHost(id) {
      const row = await loadOwned(deps, id);
      if (!row || row.status === "resolved") return NOT_ACTIONABLE;
      // Wildcard rules only make sense for the ext_authz path; the
      // acp_native path's verdict goes back to the harness, which has its
      // own per-tool rule model. Treat the host-wildcard request as
      // approvePermanent for acp_native.
      if (row.type === "ext_authz" && row.payload.kind === "ext_authz") {
        const rule = {
          host: row.payload.host,
          method: "*",
          pathPattern: "*",
          verdict: "allow" as const,
        };
        await deps.egressRuleWriter.insert({
          id: randomUUID(),
          agentId: row.agentId,
          ...rule,
          decidedBy: deps.ownerSub,
          source: "inbox",
        });
        const casWon = await deps.repo.resolvePending(
          id,
          "allow",
          deps.ownerSub,
        );
        await deps.notifier.notifyResolved(id);
        // Host-wide allow (method:*/path:*) — a broad widening of the
        // allow-list; flag it.
        auditVerdict(deps, row, "allow", {
          verdict: "allow",
          ruleWritten: true,
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
        await deps.egressRuleWriter.insert({
          id: randomUUID(),
          agentId: row.agentId,
          ...rule,
          decidedBy: deps.ownerSub,
          source: "inbox",
        });
        const casWon = await deps.repo.resolvePending(
          id,
          "deny",
          deps.ownerSub,
        );
        await deps.notifier.notifyResolved(id);
        auditVerdict(deps, row, "deny", {
          verdict: "deny",
          ruleWritten: true,
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
      // Symmetric to approveOnce: resolve the held call without writing
      // a rule. Future requests of the same shape will re-prompt.
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

/**
 * Resolve an ACP-native row and deliver the response frame to the wrapper
 * inline. Order: CAS-resolve in DB → send WS frame → mark delivered_at.
 * On send failure the row stays `resolved AND delivered_at IS NULL`; the
 * periodic sweep on any replica will retry. The wrapper deduplicates by
 * JSON-RPC id, so a sweep retry that overlaps a successful inline send is
 * harmless. Returns whether this call won the pending → resolved CAS.
 */
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
  } catch {
    // Intentionally swallow — the sweep will retry. The user has seen their
    // verdict accepted in the inbox; agent-side resumption is best-effort
    // beyond the click and self-heals on the next sweep tick.
  }
  return casWon;
}
