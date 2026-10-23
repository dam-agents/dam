import { egressProposalInputSchema } from "api-server-api";
import { describe, expect, it } from "vitest";

import { configureLogger } from "../../core/logger.js";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";
import { createEgressProposals } from "../../modules/approvals/services/egress-proposals.js";

/**
 * TEST_OVERVIEW: an Agent proposes an egress rule to its owner ahead of need. The proposal waits as an approval; the same rule proposed again joins it, only the owner's verdict writes a rule, and the Agent reads back the verdict.
 */

configureLogger({ level: "error", write: () => {} });

function world(opts: { allowed?: boolean } = {}) {
  const rows: PendingApprovalRow[] = [];
  const written: { host: string; method: string; pathPattern: string }[] = [];
  const repo = {
    insertPending: async (row) => {
      if (rows.some((r) => r.id === row.id)) return false;
      rows.push({
        ...row,
        createdAt: new Date(),
        resolvedAt: null,
        verdict: null,
        decidedBy: null,
        status: "pending",
        deliveredAt: null,
      });
      return true;
    },
    getPending: async (id) => rows.find((r) => r.id === id) ?? null,
    listPendingForInstance: async (agentId) =>
      rows.filter((r) => r.agentId === agentId && r.status === "pending"),
    resolvePending: async (id, verdict, decidedBy) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      Object.assign(row, { status: "resolved", verdict, decidedBy });
      return true;
    },
  } as Partial<ApprovalsRepository> as ApprovalsRepository;
  const proposals = createEgressProposals({
    repo,
    ruleMatcher: {
      match: async () =>
        opts.allowed
          ? {
              verdict: "allow",
              rule: {} as never,
            }
          : null,
    },
    agentId: "agent-1",
    ownerSub: "owner-1",
  });
  const approvals = createApprovalsService({
    repo,
    egressRuleWriter: {
      insert: async (input) => {
        written.push(input);
        return {
          kind: "inserted",
          row: { id: input.id, verdict: input.verdict, source: "inbox" },
        };
      },
    },
    wrapperFrameSender: { send: async () => {} },
    isAgentOwnedBy: async () => true,
    ownerSub: "owner-1",
    agentBinding: "*",
  });
  return { proposals, approvals, written };
}

const issues = {
  host: "api.github.com",
  method: "POST",
  path: "/repos/acme/sandbox/issues",
  reason: "file the issue a test asks for",
} as const;

describe("egress proposals", () => {
  // TEST_SCENARIO: the agent proposes a rule twice and gets one proposal; the owner's allow writes exactly the proposed rule, and the agent reads that it was allowed.
  it("writes the proposed rule only when the owner allows it", async () => {
    const w = world();
    const first = await w.proposals.propose(issues);
    expect(first).toMatchObject({ status: "pending" });
    expect(await w.proposals.propose(issues)).toEqual(first);
    expect(w.written).toHaveLength(0);

    const id = (first as { id: string }).id;
    await w.approvals.approvePermanent(id);
    expect(w.written).toMatchObject([
      {
        host: "api.github.com",
        method: "POST",
        pathPattern: "/repos/acme/sandbox/issues",
        verdict: "allow",
        agentId: "agent-1",
      },
    ]);
    expect(await w.proposals.status(id)).toEqual({ id, status: "allowed" });
  });

  // TEST_SCENARIO: a declined proposal writes no rule, and a rule that already lets the request through files no proposal at all.
  it("writes nothing on a decline and files nothing already allowed", async () => {
    const w = world();
    const proposed = (await w.proposals.propose(issues)) as { id: string };
    await w.approvals.dismiss(proposed.id);
    expect(w.written).toHaveLength(0);
    expect(await w.proposals.status(proposed.id)).toEqual({
      id: proposed.id,
      status: "declined",
    });

    expect(await world({ allowed: true }).proposals.propose(issues)).toEqual({
      status: "already-allowed",
    });
  });

  // TEST_SCENARIO: the owner reads the agent's path and reason in a terminal too, so a control character that could rewrite what the owner sees is refused.
  it("refuses control characters in the agent's text", () => {
    for (const bad of [
      { ...issues, reason: "ok\u001b[2K" },
      { ...issues, path: "/repos/\u0007" },
    ]) {
      expect(egressProposalInputSchema.safeParse(bad).success).toBe(false);
    }
    expect(egressProposalInputSchema.safeParse(issues).success).toBe(true);
  });
});
