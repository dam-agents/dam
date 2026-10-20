// TEST_OVERVIEW: one pending tool approval can meet two verdicts at once, from Home and from the chat. The tool runs on exactly one answer: a verdict that loses the row decision must not reach the harness, and the row must record the answer the runtime accepted, not the one that lost. The harness stand-in here accepts the first answer to arrive and drops every later one, as the runtime does.
import { describe, expect, it } from "vitest";
import type { ApprovalVerdict } from "api-server-api";

import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsRelayService } from "../../modules/approvals/services/approvals-relay-service.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";
import { createToolApprovalReports } from "../../modules/approvals/services/tool-approval-reports.js";
import type { RedisBus } from "../../core/redis-bus.js";

const AGENT = "agent-1";
const SESSION = "sess-1";
const RPC = "platform-lease-in-07f1-3-11";
const ROW = `acpnative:${AGENT}:${SESSION}:${RPC}`;
const OPTIONS = [
  { optionId: "allow", kind: "allow_once" as const },
  { optionId: "no", kind: "reject_once" as const },
];

function makeRepo() {
  const rows: PendingApprovalRow[] = [];
  let holdNextCas: Promise<void> | null = null;
  const repo = {
    insertIfAbsent: async (row) => {
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
    listPendingForInstance: async () => [],
    resolvePending: async (
      id: string,
      verdict: ApprovalVerdict,
      decidedBy: string,
      opts?: { markDelivered?: boolean },
    ) => {
      if (holdNextCas) {
        const gate = holdNextCas;
        holdNextCas = null;
        await gate;
      }
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      Object.assign(row, {
        status: "resolved",
        verdict,
        decidedBy,
        resolvedAt: new Date(),
        ...(opts?.markDelivered && { deliveredAt: new Date() }),
      });
      return true;
    },
    correctResolvedVerdict: async (id: string, verdict: ApprovalVerdict) => {
      const row = rows.find((r) => r.id === id && r.status === "resolved");
      if (!row || row.verdict === verdict) return false;
      row.verdict = verdict;
      return true;
    },
    markDelivered: async () => {},
    expirePending: async () => false,
  } as Partial<ApprovalsRepository> as ApprovalsRepository;
  return {
    rows,
    repo,
    holdNextCas: (gate: Promise<void>) => {
      holdNextCas = gate;
    },
  };
}

function makeHarness() {
  const frames: { optionId?: string }[] = [];
  let accepted: { optionId?: string } | null = null;
  const answer = (optionId?: string) => {
    if (!accepted) accepted = { ...(optionId !== undefined && { optionId }) };
  };
  return {
    frames,
    accepted: () => accepted,
    answer,
    sender: {
      async send(_agentId: string, frame: string) {
        const parsed = JSON.parse(frame) as {
          result: { outcome: { optionId?: string } };
        };
        const optionId = parsed.result.outcome.optionId;
        frames.push({ optionId });
        answer(optionId);
      },
    },
  };
}

function setup() {
  const { rows, repo, holdNextCas } = makeRepo();
  const harness = makeHarness();
  const relay = createApprovalsRelayService({ repo, bus: {} as RedisBus });
  const reports = createToolApprovalReports({ relay, ownerSub: "owner-1" });
  const service = createApprovalsService({
    repo,
    egressRuleWriter: {
      insert: async (input) => ({
        kind: "inserted",
        row: { id: input.id, verdict: input.verdict, source: "inbox" },
      }),
    },
    wrapperFrameSender: harness.sender,
    isAgentOwnedBy: async () => true,
    ownerSub: "owner-1",
    agentBinding: "*",
  });
  const asked = () =>
    relay.recordAcpNativePending({
      agentId: AGENT,
      sessionId: SESSION,
      rpcId: RPC,
      ownerSub: "owner-1",
      toolName: "Bash rm -rf build",
      toolCallId: "tc-11",
      args: { command: "rm -rf build" },
      options: OPTIONS,
    });
  return { rows, harness, reports, service, asked, holdNextCas };
}

describe("tool approval race", () => {
  // TEST_SCENARIO: two clients act on the same pending row, each having loaded it as pending, so both reach the row decision. The denial decides it; the approval loses. A losing approval that is still sent arrives first and the runtime accepts it, so the tool runs under a recorded denial. The loser must not be transmitted.
  it("never transmits a verdict that lost the row decision", async () => {
    const { rows, harness, service, asked, holdNextCas } = setup();
    await asked();

    let releaseApproval: () => void = () => {};
    holdNextCas(
      new Promise<void>((resolve) => {
        releaseApproval = resolve;
      }),
    );

    const approval = service.approveOnce(ROW);
    await Promise.resolve();
    const denial = await service.dismiss(ROW);
    releaseApproval();
    const approvalOutcome = await approval;
    await denial;

    expect(harness.frames.map((f) => f.optionId)).toEqual(["no"]);
    expect(harness.accepted()).toEqual({ optionId: "no" });
    expect(approvalOutcome.outcome).toBe("not_actionable");
    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "deny_once",
    });
  });

  // TEST_SCENARIO: the chat answered before Home did, and the runtime took that answer, while Home's approval decided the row. The record and the tool must not disagree: the runtime accepted a denial, so the row must end denied even though Home recorded an approval.
  it("records the answer the runtime accepted, not the one that lost", async () => {
    const { rows, harness, reports, service, asked } = setup();
    await asked();
    harness.answer("no");

    const outcome = await service.approveOnce(ROW);
    await reports.ended(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      outcome: { outcome: "selected", optionId: "no" },
    });

    expect(outcome.outcome).toBe("applied");
    expect(harness.accepted()).toEqual({ optionId: "no" });
    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "deny_once",
    });
  });
});
