// TEST_OVERVIEW: the owner's verdicts on a held web search. Allow once and deny answer only the held search. Always allow and always deny write the agent's one web search rule, never an egress rule and never anything about the query, and they still write it when the hold already expired, so the agent's next search is answered by the rule. Allowing a whole host has no meaning for a search, so it changes nothing.
import { describe, expect, it } from "vitest";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";

function searchRow(status: PendingApprovalRow["status"]): PendingApprovalRow {
  return {
    id: "search-1",
    type: "web_search",
    agentId: "agent-1",
    ownerSub: "owner-1",
    sessionId: null,
    payload: { kind: "web_search", query: "dam news", key: "query:k" },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resolvedAt: null,
    verdict: null,
    decidedBy: null,
    status,
    deliveredAt: null,
  };
}

function makeService(seed: PendingApprovalRow) {
  const rows = [seed];
  const webSearchRules: {
    agentId: string;
    verdict: string;
    decidedBy: string;
  }[] = [];
  const egressRules: unknown[] = [];
  const settle =
    (from: PendingApprovalRow["status"]) =>
    async (id: string, verdict: string, decidedBy: string) => {
      const row = rows.find((r) => r.id === id && r.status === from);
      if (!row) return false;
      row.status = "resolved";
      row.verdict = verdict as PendingApprovalRow["verdict"];
      row.decidedBy = decidedBy;
      return true;
    };
  const repo = {
    getPending: async (id: string) => rows.find((r) => r.id === id) ?? null,
    resolvePending: settle("pending"),
    resolveExpired: settle("expired"),
  } as unknown as ApprovalsRepository;
  const service = createApprovalsService({
    repo,
    webSearchRuleWriter: {
      write: async (input) => void webSearchRules.push(input),
    },
    egressRuleWriter: {
      insert: async (input) => {
        egressRules.push(input);
        throw new Error("a web search verdict writes no egress rule");
      },
    },
    wrapperFrameSender: { send: async () => {} },
    isAgentOwnedBy: async () => true,
    ownerSub: "owner-1",
    actor: "owner-1",
    actorEmail: null,
    agentBinding: "*",
  });
  return { rows, service, webSearchRules, egressRules };
}

describe("verdicts on a held web search", () => {
  // TEST_SCENARIO: allow once and deny answer the one held search and write no rule.
  it("answers once without a rule", async () => {
    const allowed = makeService(searchRow("pending"));
    expect((await allowed.service.approveOnce("search-1")).outcome).toBe(
      "applied",
    );
    expect(allowed.rows[0]!.verdict).toBe("allow_once");

    const denied = makeService(searchRow("pending"));
    expect((await denied.service.dismiss("search-1")).outcome).toBe("applied");
    expect(denied.rows[0]!.verdict).toBe("deny_once");
    expect([...allowed.webSearchRules, ...denied.webSearchRules]).toEqual([]);
  });

  // TEST_SCENARIO: always allow and always deny write the agent's web search rule, by the owner, and resolve the held search with the same verdict.
  it("writes the agent's web search rule when always", async () => {
    const allowed = makeService(searchRow("pending"));
    const outcome = await allowed.service.approvePermanent("search-1");
    expect(outcome).toEqual({
      outcome: "applied",
      type: "web_search",
      rule: null,
    });
    expect(allowed.webSearchRules).toEqual([
      { agentId: "agent-1", verdict: "allow", decidedBy: "owner-1" },
    ]);

    const denied = makeService(searchRow("pending"));
    await denied.service.denyForever("search-1");
    expect(denied.webSearchRules).toEqual([
      { agentId: "agent-1", verdict: "deny", decidedBy: "owner-1" },
    ]);
    expect(denied.rows[0]!.verdict).toBe("deny");
    expect([...allowed.egressRules, ...denied.egressRules]).toEqual([]);
  });

  // TEST_SCENARIO: a hold that already expired, as an unattended run's does at once, still takes a permanent verdict, so the next run's search is answered by the rule.
  it("writes the rule on an expired search", async () => {
    const { service, webSearchRules } = makeService(searchRow("expired"));
    expect((await service.approvePermanent("search-1")).outcome).toBe(
      "rule_written_expired",
    );
    expect(webSearchRules).toHaveLength(1);
  });

  // TEST_SCENARIO: allowing a whole host does not apply to a search, so it writes nothing.
  it("does nothing for allow all of a host", async () => {
    const { service, webSearchRules, egressRules } = makeService(
      searchRow("pending"),
    );
    expect((await service.approveHost("search-1")).outcome).toBe(
      "not_actionable",
    );
    expect([...webSearchRules, ...egressRules]).toEqual([]);
  });
});
