import { describe, expect, test } from "vitest";

import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";

function extAuthzRow(
  overrides: Partial<PendingApprovalRow> = {},
): PendingApprovalRow {
  return {
    id: "appr-1",
    type: "ext_authz",
    agentId: "agent-1",
    ownerSub: "owner-1",
    sessionId: null,
    payload: {
      kind: "ext_authz",
      host: "api.example.com",
      method: "GET",
      path: "/v1/data",
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() - 60_000),
    resolvedAt: null,
    verdict: null,
    decidedBy: null,
    status: "expired",
    deliveredAt: null,
    ...overrides,
  };
}

function makeService(seed: PendingApprovalRow) {
  const rows = [seed];
  const inserts: { verdict: string }[] = [];
  const repo: ApprovalsRepository = {
    insertPending: async () => {},
    getPending: async (id) => rows.find((r) => r.id === id) ?? null,
    findActivePendingExtAuthz: async () => null,
    listPendingForOwner: async () => rows,
    listPendingForInstance: async () => rows,
    resolvePending: async (id, verdict, decidedBy) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      row.status = "resolved";
      if (verdict !== "deny_once") row.verdict = verdict;
      row.decidedBy = decidedBy;
      row.resolvedAt = new Date();
      return true;
    },
    resolveExpired: async (id, verdict, decidedBy) => {
      const row = rows.find((r) => r.id === id && r.status === "expired");
      if (!row) return;
      row.status = "resolved";
      row.verdict = verdict;
      row.decidedBy = decidedBy;
      row.resolvedAt = new Date();
      row.deliveredAt = new Date();
    },
    markDelivered: async () => {},
    listResolvedUndelivered: async () => [],
    expirePending: async () => {},
    expireOverdue: async () => [],
    deleteForAgent: async () => {},
    listDistinctAgentIds: async () => [],
  };
  const service = createApprovalsService({
    repo,
    egressRuleWriter: {
      insert: async (input) => {
        inserts.push({ verdict: input.verdict });
      },
    },
    notifier: { notifyResolved: async () => {} },
    wrapperFrameSender: { send: async () => {} },
    isAgentOwnedBy: async () => true,
    ownerSub: "owner-1",
    agentBinding: "*",
  });
  return { rows, service, inserts };
}

describe("approvals verdicts on expired requests (#2125)", () => {
  test("approvePermanent writes the rule and resolves an expired row", async () => {
    const { rows, service, inserts } = makeService(extAuthzRow());
    const outcome = await service.approvePermanent("appr-1");
    expect(inserts).toHaveLength(1);
    expect(outcome.outcome).toBe("rule_written_expired");
    expect(rows[0].status).toBe("resolved");
    expect(rows[0].deliveredAt).not.toBeNull();
  });

  test("denyForever resolves an expired row", async () => {
    const { rows, service } = makeService(extAuthzRow());
    await service.denyForever("appr-1");
    expect(rows[0].status).toBe("resolved");
    expect(rows[0].verdict).toBe("deny");
  });

  test("a live pending row still resolves via the CAS path (applied)", async () => {
    const { rows, service } = makeService(
      extAuthzRow({
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const outcome = await service.approvePermanent("appr-1");
    expect(outcome.outcome).toBe("applied");
    expect(rows[0].status).toBe("resolved");
  });
});
