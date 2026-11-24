// TEST_OVERVIEW: the verdicts on a held MCP tool call. A tool-call approval takes approve once and deny once only: each answers the one held call and writes no rule. Nothing is remembered for the next call, so always allow, allow the whole host and always deny change nothing and answer not actionable. An approve once counts only inside the hold window: after it, the approval answers not actionable.
import { describe, expect, it } from "vitest";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";

function toolCallRow(
  expiresAt = new Date(Date.now() + 60_000),
): PendingApprovalRow {
  return {
    id: "call-1",
    type: "mcp_tool_call",
    agentId: "agent-1",
    ownerSub: "owner-1",
    sessionId: null,
    payload: {
      kind: "mcp_tool_call",
      connectionId: "conn-1",
      connectionName: "Notes",
      templateId: null,
      tool: "notes_write",
      key: "k",
      arguments: { text: "hello" },
      argumentsBytes: 16,
    },
    createdAt: new Date(),
    expiresAt,
    resolvedAt: null,
    verdict: null,
    decidedBy: null,
    status: "pending",
    deliveredAt: null,
  };
}

function makeService(row = toolCallRow()) {
  const rows = [row];
  const rules: unknown[] = [];
  const repo = {
    getPending: async (id: string) => {
      const row = rows.find((r) => r.id === id);
      return row ? { ...row } : null;
    },
    resolvePending: async (id: string, verdict: string) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      row.status = "resolved";
      row.verdict = verdict as PendingApprovalRow["verdict"];
      return true;
    },
    resolveExpired: async () => false,
  } as unknown as ApprovalsRepository;
  const service = createApprovalsService({
    repo,
    webSearchRuleWriter: { write: async (input) => void rules.push(input) },
    egressRuleWriter: {
      insert: async (input) => {
        rules.push(input);
        throw new Error("a tool-call verdict writes no egress rule");
      },
    },
    wrapperFrameSender: { send: async () => {} },
    isAgentOwnedBy: async () => true,
    ownerSub: "owner-1",
    actor: "owner-1",
    actorEmail: null,
    agentBinding: "*",
  });
  return { rows, rules, service };
}

describe("verdicts on a held MCP tool call", () => {
  // TEST_SCENARIO: approve once and deny once each settle the held call with a once verdict and write no rule.
  it("answers once without a rule", async () => {
    const allowed = makeService();
    expect((await allowed.service.approveOnce("call-1")).outcome).toBe(
      "applied",
    );
    expect(allowed.rows[0]!.verdict).toBe("allow_once");

    const denied = makeService();
    expect((await denied.service.dismiss("call-1")).outcome).toBe("applied");
    expect(denied.rows[0]!.verdict).toBe("deny_once");
    expect([...allowed.rules, ...denied.rules]).toEqual([]);
  });

  // TEST_SCENARIO: a permanent or host-wide verdict has no meaning for a tool call, so it leaves the approval waiting and answers not actionable.
  it("refuses every verdict that would be remembered", async () => {
    const { rows, rules, service } = makeService();
    for (const answer of [
      service.approvePermanent,
      service.approveHost,
      service.denyForever,
      service.approveForChildren,
    ])
      expect((await answer("call-1")).outcome).toBe("not_actionable");
    expect(rows[0]!.status).toBe("pending");
    expect(rules).toEqual([]);
  });

  // TEST_SCENARIO: the hold window has ended, whether or not the sweeper has marked the approval expired yet. No call could use an approve once now, so it answers not actionable and leaves the approval as it is.
  it("answers not actionable after the hold window", async () => {
    const past = new Date(Date.now() - 1_000);
    const late = makeService(toolCallRow(past));
    expect((await late.service.approveOnce("call-1")).outcome).toBe(
      "not_actionable",
    );
    expect(late.rows[0]!.status).toBe("pending");

    const expired = makeService({ ...toolCallRow(past), status: "expired" });
    expect((await expired.service.approveOnce("call-1")).outcome).toBe(
      "not_actionable",
    );
  });
});
