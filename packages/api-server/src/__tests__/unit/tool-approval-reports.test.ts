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
      const existing = rows.find((r) => r.id === row.id);
      if (existing) {
        if (
          existing.status !== "expired" &&
          !(existing.status === "resolved" && existing.deliveredAt !== null)
        )
          return false;
        Object.assign(existing, {
          payload: row.payload,
          createdAt: new Date(),
          status: "pending",
          verdict: null,
          decidedBy: null,
          resolvedAt: null,
          deliveredAt: null,
        });
        return true;
      }
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
    resolvePending: async (id, verdict, decidedBy, opts) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      Object.assign(row, {
        status: "resolved",
        verdict,
        decidedBy,
        ...(opts?.markDelivered && { deliveredAt: new Date() }),
      });
      return true;
    },
    correctResolvedVerdict: async (id, verdict) => {
      const row = rows.find((r) => r.id === id && r.status === "resolved");
      if (!row || row.verdict === verdict) return false;
      row.verdict = verdict;
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

  // TEST_SCENARIO: the viewer left, a late report was queued, the viewer came back and answered in chat before the report landed. The delayed write of the same request must not reopen the row: Home would offer a decision the tool already acted on, and nothing would close it again.
  it("leaves a resolved row resolved when its report arrives late", async () => {
    const { rows, relay, waiting } = setup();
    await waiting();
    await relay.resolveAcpNativeFromInSession(ROW, {
      outcome: "selected",
      optionId: "no",
    });

    await waiting();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "deny_once",
    });
  });

  // TEST_SCENARIO: the runtime gave up on a request and its row expired, then a last report for that same request arrives. It must stay expired rather than come back as a pending decision nobody can act on.
  it("leaves an expired row expired when its report arrives late", async () => {
    const { rows, reports, waiting } = setup();
    await waiting();
    await reports.ended(AGENT, { sessionId: SESSION, rpcId: RPC });

    await waiting();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("expired");
  });

  // TEST_SCENARIO: a watched request is the relay's row, so the runtime never reported it as waiting. When the session resets, or the pod tears the request down, the runtime reports the end: the row must expire, or Home keeps offering a decision that reaches nothing.
  it("expires a relay-written row when the runtime reports its end", async () => {
    const { rows, relay, reports } = setup();
    await relay.recordAcpNativePending({
      agentId: AGENT,
      sessionId: SESSION,
      rpcId: RPC,
      ownerSub: "owner-1",
      toolName: "Write /tmp/a",
      toolCallId: "tc-7",
      args: { path: "/tmp/a" },
      options: OPTIONS,
    });

    await reports.ended(AGENT, { sessionId: SESSION, rpcId: RPC });

    expect(rows[0]?.status).toBe("expired");
  });

  // TEST_SCENARIO: the chat and Home disagreed — Home recorded a denial while the harness had already taken an allow from the chat. The runtime accepted that allow, so its report must settle the row on it: the record may never claim a decision the tool did not act on.
  it("settles a decided row on the answer the runtime accepted", async () => {
    const { rows, relay, reports, waiting } = setup();
    await waiting();
    await relay.resolveAcpNativeFromInSession(ROW, {
      outcome: "selected",
      optionId: "no",
    });

    await reports.ended(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      outcome: { outcome: "selected", optionId: "allow" },
    });

    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "allow_once",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: EventType.ApprovalResolved,
        approvalId: ROW,
        resolution: "allow_once",
      }),
    );
  });
});
