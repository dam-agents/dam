import { describe, expect, test } from "vitest";

import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";

// TEST_OVERVIEW: an agent that hits one blocked host again and again can pile up dozens of pending approvals (#4716). dismissMany denies a list of them once each, in one call, exactly as dismiss does for one: only the owner's pending rows resolve, as deny_once, and the result counts the rows it resolved.

function row(
  id: string,
  overrides: Partial<PendingApprovalRow> = {},
): PendingApprovalRow {
  return {
    id,
    type: "ext_authz",
    agentId: "agent-1",
    ownerSub: "owner-1",
    sessionId: null,
    payload: {
      kind: "ext_authz",
      host: "127.0.0.1",
      method: "GET",
      path: "/api/version",
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resolvedAt: null,
    verdict: null,
    decidedBy: null,
    status: "pending",
    deliveredAt: null,
    ...overrides,
  };
}

function makeService(rows: PendingApprovalRow[]) {
  const resolved: { id: string; verdict: string }[] = [];
  const frames: string[] = [];
  const repo: ApprovalsRepository = {
    insertPending: async () => true,
    insertIfAbsent: async () => true,
    getPending: async (id) => rows.find((r) => r.id === id) ?? null,
    findActivePendingExtAuthz: async () => null,
    listPendingForOwner: async () => rows,
    listPendingForInstance: async () => rows,
    resolvePending: async (id, verdict, decidedBy) => {
      const found = rows.find((r) => r.id === id && r.status === "pending");
      if (!found) return false;
      found.status = "resolved";
      found.decidedBy = decidedBy;
      found.resolvedAt = new Date();
      resolved.push({ id, verdict });
      return true;
    },
    resolveExpired: async () => false,
    markDelivered: async () => {},
    listResolvedUndelivered: async () => [],
    expirePending: async () => false,
    expireOverdue: async () => [],
    deleteForAgent: async () => {},
    listDistinctAgentIds: async () => [],
  };
  const service = createApprovalsService({
    repo,
    egressRuleWriter: {
      insert: async () => {
        throw new Error("dismissMany must not write a rule");
      },
    },
    wrapperFrameSender: {
      send: async (_agentId, frame) => {
        frames.push(frame);
      },
    },
    isAgentOwnedBy: async () => true,
    ownerSub: "owner-1",
    agentBinding: "*",
  });
  return { service, resolved, frames };
}

describe("approvals dismissMany (#4716)", () => {
  // TEST_SCENARIO: the issue's case. Many queued copies of one request are denied in one call, each once, and no deny rule is written, so a later request asks again.
  test("denies every listed pending approval once", async () => {
    const { service, resolved } = makeService([row("a"), row("b"), row("c")]);
    const outcome = await service.dismissMany(["a", "b", "c"]);
    expect(outcome).toEqual({ applied: 3 });
    expect(resolved).toEqual([
      { id: "a", verdict: "deny_once" },
      { id: "b", verdict: "deny_once" },
      { id: "c", verdict: "deny_once" },
    ]);
  });

  // TEST_SCENARIO: the list comes from what the client showed, so some rows may have been answered meanwhile, belong to another owner, or no longer exist. Those are skipped, not counted, and do not stop the rest.
  test("skips rows it cannot dismiss and counts only the ones it resolved", async () => {
    const { service, resolved } = makeService([
      row("mine"),
      row("answered", { status: "resolved", verdict: "allow_once" }),
      row("theirs", { ownerSub: "owner-2" }),
    ]);
    const outcome = await service.dismissMany([
      "answered",
      "theirs",
      "gone",
      "mine",
    ]);
    expect(outcome).toEqual({ applied: 1 });
    expect(resolved.map((r) => r.id)).toEqual(["mine"]);
  });

  // TEST_SCENARIO: a repeated id is one approval, so it resolves once and counts once.
  test("treats a repeated id as one approval", async () => {
    const { service, resolved } = makeService([row("a")]);
    expect(await service.dismissMany(["a", "a"])).toEqual({ applied: 1 });
    expect(resolved).toHaveLength(1);
  });

  // TEST_SCENARIO: a tool-call approval is answered through the wrapper, so dismissMany sends its deny frame too, the same way dismiss does.
  test("delivers the deny to a waiting tool-call approval", async () => {
    const { service, resolved, frames } = makeService([
      row("tool", {
        type: "acp_native",
        payload: {
          kind: "acp_native",
          toolName: "Bash",
          rpcId: 7,
          options: [{ optionId: "no", kind: "reject_once" }],
        },
      }),
    ]);
    expect(await service.dismissMany(["tool"])).toEqual({ applied: 1 });
    expect(resolved).toEqual([{ id: "tool", verdict: "deny_once" }]);
    expect(frames).toHaveLength(1);
  });
});
