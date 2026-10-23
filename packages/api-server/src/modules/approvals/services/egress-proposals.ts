import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { EgressProposalInput } from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { PendingApprovalRow } from "../domain/types.js";
import type { EgressRuleMatcher } from "./ext-authz-gate.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";

export const EGRESS_PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EGRESS_PROPOSALS_PENDING_MAX = 20;

export type EgressProposalState =
  | {
      id: string;
      status: "pending" | "allowed" | "declined" | "expired";
    }
  | { status: "already-allowed" };

export interface EgressProposals {
  propose(input: EgressProposalInput): Promise<EgressProposalState>;
  status(id: string): Promise<EgressProposalState>;
}

function proposalId(agentId: string, input: EgressProposalInput): string {
  const shape = JSON.stringify([
    input.host.toLowerCase(),
    input.port ?? null,
    input.method,
    input.path,
  ]);
  const digest = createHash("sha256").update(shape).digest("hex").slice(0, 32);
  return `egressproposal:${agentId}:${digest}`;
}

function stateOf(row: PendingApprovalRow): EgressProposalState {
  if (row.status === "pending") return { id: row.id, status: "pending" };
  if (row.status === "expired") return { id: row.id, status: "expired" };
  return {
    id: row.id,
    status: row.verdict === "allow" ? "allowed" : "declined",
  };
}

function isConcrete(input: EgressProposalInput): boolean {
  return (
    input.method !== "*" &&
    !input.host.includes("*") &&
    !input.path.includes("*")
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an Agent proposes an egress rule to its owner
 * before it needs it, rather than waiting for a held request that nobody may
 * be there to answer. A proposal is an approval row of type egress_proposal:
 * the owner sees the rule and the Agent's reason where waiting approvals show,
 * and only the owner's verdict writes a rule. One rule shape is one proposal,
 * so asking again joins the open one; an Agent holds a bounded number open.
 */
export function createEgressProposals(deps: {
  repo: ApprovalsRepository;
  ruleMatcher: EgressRuleMatcher;
  agentId: string;
  ownerSub: string;
  now?: () => number;
}): EgressProposals {
  const now = deps.now ?? (() => Date.now());

  async function alreadyAllowed(input: EgressProposalInput): Promise<boolean> {
    if (!isConcrete(input)) return false;
    const matched = await deps.ruleMatcher.match(
      deps.agentId,
      input.host,
      input.port ?? 443,
      true,
      input.method,
      input.path,
    );
    return matched?.verdict === "allow";
  }

  return {
    async propose(input) {
      if (await alreadyAllowed(input)) return { status: "already-allowed" };
      const id = proposalId(deps.agentId, input);
      const existing = await deps.repo.getPending(id);
      if (existing?.status === "pending") return stateOf(existing);
      const open = await deps.repo.listPendingForInstance(deps.agentId, {
        status: "pending",
        limit: 500,
      });
      if (
        open.filter((r) => r.type === "egress_proposal").length >=
        EGRESS_PROPOSALS_PENDING_MAX
      ) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `you already have ${EGRESS_PROPOSALS_PENDING_MAX} proposed rules waiting for your owner; wait for a verdict before you propose more`,
        });
      }
      const filed = await deps.repo.insertPending({
        id,
        type: "egress_proposal",
        agentId: deps.agentId,
        ownerSub: deps.ownerSub,
        sessionId: null,
        payload: {
          kind: "egress_proposal",
          host: input.host,
          ...(input.port !== undefined ? { port: input.port } : {}),
          method: input.method,
          path: input.path,
          reason: input.reason,
        },
        expiresAt: new Date(now() + EGRESS_PROPOSAL_TTL_MS),
      });
      if (!filed) {
        const row = await deps.repo.getPending(id);
        if (row) return stateOf(row);
        throw new Error("the proposal could not be filed");
      }
      securityLog("info", "approval.egress_proposed", {
        category: "approval",
        actor: deps.agentId,
        actorKind: "agent",
        agentId: deps.agentId,
        correlationId: id,
        detail: {
          host: input.host,
          port: input.port ?? null,
          method: input.method,
          path: input.path,
        },
      });
      emit({
        type: EventType.ApprovalRequested,
        approvalId: id,
        agentId: deps.agentId,
        ownerSub: deps.ownerSub,
      });
      return { id, status: "pending" };
    },

    async status(id) {
      const row = await deps.repo.getPending(id);
      if (
        !row ||
        row.agentId !== deps.agentId ||
        row.type !== "egress_proposal"
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "no such proposal" });
      }
      return stateOf(row);
    },
  };
}
