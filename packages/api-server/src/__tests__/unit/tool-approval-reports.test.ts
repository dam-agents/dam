import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Subscription } from "rxjs";
import { acpNativeRowId } from "api-server-api";

import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsRelayService } from "../../modules/approvals/services/approvals-relay-service.js";
import { createToolApprovalReports } from "../../modules/approvals/services/tool-approval-reports.js";
import type { RedisBus } from "../../core/redis-bus.js";
import { EventType, events$, type DomainEvent } from "../../events.js";

// TEST_OVERVIEW: the agent-runtime reports a tool approval nobody watches, so the platform records it when the agent asks rather than when someone opens the session. The row is the one the ACP relay writes, so a client that engages later joins it and the row keeps the time the agent asked; the reported end resolves it with the chosen verdict, or expires it when the agent stopped waiting.

const AGENT = "agent-1";
const SESSION = "sess-1";
const RPC = "platform-lease-in-1-7";
const ROW = acpNativeRowId(AGENT, SESSION, RPC);
const OPTIONS = [
  { optionId: "allow", kind: "allow_once" as const },
  { optionId: "no", kind: "reject_once" as const },
];

function makeRepo() {
  const rows: PendingApprovalRow[] = [];
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
    listPendingForInstance: async () => [],
    resolvePending: async (id, verdict, decidedBy) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      Object.assign(row, { status: "resolved", verdict, decidedBy });
      return true;
    },
    expirePending: async (id) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      row.status = "expired";
      return true;
    },
  } as Partial<ApprovalsRepository> as ApprovalsRepository;
  return { rows, repo };
}

function setup() {
  const { rows, repo } = makeRepo();
  const relay = createApprovalsRelayService({ repo, bus: {} as RedisBus });
  const reports = createToolApprovalReports({ relay, ownerSub: "owner-1" });
  const waiting = () =>
    reports.waiting(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      toolName: "Write /tmp/a",
      toolCallId: "tc-7",
      args: { path: "/tmp/a" },
      options: OPTIONS,
    });
  return { rows, relay, reports, waiting };
}

let events: DomainEvent[] = [];
let sub: Subscription;
beforeEach(() => {
  events = [];
  sub = events$().subscribe((e) => events.push(e));
});
afterEach(() => sub.unsubscribe());

describe("tool approval reports", () => {
  // TEST_SCENARIO: the bug's own case — nobody has the session open when the agent asks. The request must become a pending row for the agent's owner at once, and Home must be told.
  it("records a reported request as a pending approval for the owner", async () => {
    const { rows, waiting } = setup();
    await waiting();

    expect(rows).toEqual([
      expect.objectContaining({
        id: ROW,
        type: "acp_native",
        ownerSub: "owner-1",
        sessionId: SESSION,
        status: "pending",
        payload: expect.objectContaining({
          toolName: "Write /tmp/a",
          rpcId: RPC,
          options: OPTIONS,
        }),
      }),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: EventType.ApprovalRequested,
        approvalId: ROW,
      }),
    );
  });

  // TEST_SCENARIO: the user opens the session later and the relay mirrors the same request. It must join the reported row, not replace it, so the approval keeps the time the agent asked and the relay still resolves it when the user answers in the chat.
  it("lets the relay join the reported row and keep its time", async () => {
    const { rows, relay, waiting } = setup();
    await waiting();
    const askedAt = rows[0]!.createdAt;

    const joined = await relay.recordAcpNativePending({
      agentId: AGENT,
      sessionId: SESSION,
      rpcId: RPC,
      ownerSub: "owner-1",
      toolName: "Write /tmp/a",
      toolCallId: "tc-7",
      args: { path: "/tmp/a" },
      options: OPTIONS,
    });

    expect(joined).toBe(ROW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdAt).toBe(askedAt);
  });

  // TEST_SCENARIO: an answer the runtime reports records the verdict of the option chosen, so Home stops offering a decision already made.
  it("resolves the row with the verdict of the reported answer", async () => {
    const { rows, reports, waiting } = setup();
    await waiting();

    await reports.ended(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      outcome: { outcome: "selected", optionId: "no" },
    });

    expect(rows[0]).toMatchObject({ status: "resolved", verdict: "deny_once" });
  });

  // TEST_SCENARIO: the runtime gave up on the request (its wait ran out, or the session was reset). Allowing it later would reach nothing, so the row must expire and Home must be told.
  it("expires the row of a request the agent stopped waiting for", async () => {
    const { rows, reports, waiting } = setup();
    await waiting();

    await reports.ended(AGENT, { sessionId: SESSION, rpcId: RPC });

    expect(rows[0]?.status).toBe("expired");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: EventType.ApprovalResolved,
        approvalId: ROW,
        resolution: "expired",
      }),
    );
  });

  // TEST_SCENARIO: the user decided on Home before the runtime reported the end. The late end must not overwrite that verdict.
  it("leaves a row the user already decided as it is", async () => {
    const { rows, relay, reports, waiting } = setup();
    await waiting();
    await relay.resolveAcpNativeFromInSession(ROW, {
      outcome: "selected",
      optionId: "allow",
    });

    await reports.ended(AGENT, { sessionId: SESSION, rpcId: RPC });

    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "allow_once",
    });
  });
});
