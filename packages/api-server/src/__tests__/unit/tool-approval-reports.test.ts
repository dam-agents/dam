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
  const hooks: {
    beforeInsertSettled?: () => Promise<void> | void;
    beforeResolvePending?: () => Promise<void> | void;
  } = {};
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
    insertSettled: async (row, settlement) => {
      await hooks.beforeInsertSettled?.();
      if (rows.some((r) => r.id === row.id)) return false;
      rows.push({
        ...row,
        createdAt: new Date(),
        resolvedAt: new Date(),
        decidedBy: "in-session",
        status: settlement.status,
        verdict: settlement.status === "resolved" ? settlement.verdict : null,
        deliveredAt: new Date(),
      });
      return true;
    },
    getPending: async (id) => rows.find((r) => r.id === id) ?? null,
    listPendingForInstance: async () => [],
    resolvePending: async (id, verdict, decidedBy, opts) => {
      await hooks.beforeResolvePending?.();
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
    markDelivered: async (id) => {
      const row = rows.find(
        (r) => r.id === id && r.status === "resolved" && !r.deliveredAt,
      );
      if (row) row.deliveredAt = new Date();
    },
  } as Partial<ApprovalsRepository> as ApprovalsRepository;
  return { rows, repo, hooks };
}

function setup() {
  const { rows, repo, hooks } = makeRepo();
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
  return { rows, repo, relay, reports, waiting, hooks };
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

  // TEST_SCENARIO: the report read its row as pending, and another writer decided it before the row update landed, so the report's own settle loses. It must still settle the row on the answer the harness got: losing the row decision is not losing the right to state what the tool did.
  it("corrects the row when its pending settle loses the race", async () => {
    const { rows, repo, reports, waiting } = setup();
    await waiting();
    const settle = repo.resolvePending;
    repo.resolvePending = async (id, _verdict, decidedBy, opts) => {
      await settle(id, "allow_once", decidedBy, opts);
      return false;
    };

    await reports.ended(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      outcome: { outcome: "selected", optionId: "no" },
    });

    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "deny_once",
    });
  });

  // TEST_SCENARIO: the row keeps a bounded catalog, but the client that answers later replays the whole request. An option the row dropped must still record the verdict the harness acted on, or a refusal is recorded as an allow.
  it("records the kind of an option the recorded catalog dropped", async () => {
    const allows = Array.from({ length: 16 }, (_, n) => ({
      optionId: `allow-${n}`,
      kind: "allow_once" as const,
    }));
    const { rows, reports } = setup();
    await reports.waiting(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      toolName: "Write /tmp/a",
      args: { path: "/tmp/a" },
      options: allows,
    });

    await reports.ended(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      outcome: {
        outcome: "selected",
        optionId: "reject-17",
        kind: "reject_once",
      },
    });

    expect(rows[0]).toMatchObject({ status: "resolved", verdict: "deny_once" });
  });

  // TEST_SCENARIO: the ACP relay forwards the prompt, then records it, so the session can reset before that write lands: the end arrives first. The request is over, and the delayed write must not turn it into a decision Home still offers.
  it("settles a request whose end arrives before anything recorded it", async () => {
    const { rows, reports, waiting } = setup();

    await reports.ended(AGENT, { sessionId: SESSION, rpcId: RPC });
    await waiting();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("expired");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: EventType.ApprovalResolved,
        approvalId: ROW,
        resolution: "expired",
      }),
    );
  });

  // TEST_SCENARIO: the row was resolved on Home and its answer has not been delivered yet, but the runtime reports the request's end, so that answer now reaches nothing. The record must stop retrying it at every sweep.
  it("stops delivering a resolved row once the runtime reports its end", async () => {
    const { rows, repo, reports, waiting } = setup();
    await waiting();
    await repo.resolvePending(ROW, "allow_once", "owner-1");

    await reports.ended(AGENT, { sessionId: SESSION, rpcId: RPC });

    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "allow_once",
      deliveredAt: expect.any(Date),
    });
  });

  // TEST_SCENARIO: the same ordering for an answer: the runtime accepted it before any row existed. Dropping it would leave the request as a pending approval whose answer reaches nothing.
  it("records the answer of a request whose end arrived first", async () => {
    const { rows, reports } = setup();

    await reports.ended(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      outcome: {
        outcome: "selected",
        optionId: "reject-17",
        kind: "reject_once",
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "resolved", verdict: "deny_once" });
  });

  // TEST_SCENARIO: the end arrives before anything recorded the request, and the delayed insert lands while it settles. Home can decide that row in between, and its answer reaches a runtime that already took another. The end must still correct the record, or the platform claims a decision the tool never acted on.
  it("corrects a row another writer inserted while the end was settling it", async () => {
    const { rows, repo, reports, hooks } = setup();
    hooks.beforeInsertSettled = async () => {
      hooks.beforeInsertSettled = undefined;
      await repo.insertIfAbsent({
        id: ROW,
        type: "acp_native",
        agentId: AGENT,
        ownerSub: "owner-1",
        sessionId: SESSION,
        payload: {
          kind: "acp_native",
          toolName: "tool call",
          rpcId: RPC,
          options: OPTIONS,
        },
        expiresAt: new Date(Date.now() + 60_000),
      });
      await repo.resolvePending(ROW, "allow_once", "owner-1");
    };

    await reports.ended(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      outcome: { outcome: "selected", optionId: "no" },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "resolved", verdict: "deny_once" });
  });

  // TEST_SCENARIO: the same race one step later. The settle reads the row as pending, Home decides it first, so the pending update is refused. Refusing the update is not refusing the accepted answer: the record must follow the harness.
  it("corrects a row Home decided while the end was updating it", async () => {
    const { rows, repo, reports, hooks } = setup();
    hooks.beforeInsertSettled = async () => {
      hooks.beforeInsertSettled = undefined;
      await repo.insertIfAbsent({
        id: ROW,
        type: "acp_native",
        agentId: AGENT,
        ownerSub: "owner-1",
        sessionId: SESSION,
        payload: {
          kind: "acp_native",
          toolName: "tool call",
          rpcId: RPC,
          options: OPTIONS,
        },
        expiresAt: new Date(Date.now() + 60_000),
      });
    };
    hooks.beforeResolvePending = async () => {
      hooks.beforeResolvePending = undefined;
      await repo.resolvePending(ROW, "allow_once", "owner-1");
    };

    await reports.ended(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      outcome: { outcome: "selected", optionId: "no" },
    });

    expect(rows[0]).toMatchObject({ status: "resolved", verdict: "deny_once" });
  });

  // TEST_SCENARIO: Home decided the row, but its answer never reached the runtime, because the wrapper connection failed. The chat answered the still-held request instead and the harness took that answer: the request is over, so nothing may keep queueing its delivery.
  it("closes delivery when the accepted answer matches the recorded verdict", async () => {
    const { rows, repo, reports, waiting } = setup();
    await waiting();
    await repo.resolvePending(ROW, "deny_once", "owner-1");

    await reports.ended(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      outcome: { outcome: "selected", optionId: "no" },
    });

    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "deny_once",
      deliveredAt: expect.any(Date),
    });
  });

  // TEST_SCENARIO: the same failure with the opposite verdict: the chat's answer is the one the harness got, so the record takes it, and the delivery Home never finished must stop as well.
  it("closes delivery when the accepted answer corrects the recorded verdict", async () => {
    const { rows, repo, reports, waiting } = setup();
    await waiting();
    await repo.resolvePending(ROW, "allow_once", "owner-1");

    await reports.ended(AGENT, {
      sessionId: SESSION,
      rpcId: RPC,
      outcome: { outcome: "selected", optionId: "no" },
    });

    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "deny_once",
      deliveredAt: expect.any(Date),
    });
  });

  // TEST_SCENARIO: the runtime dropped the request, and Home decided its row between the read and the expiration, so the expiration is refused. The request is over either way, so its delivery must stop instead of being retried at every sweep.
  it("closes delivery when the abandonment loses the row to a decision", async () => {
    const { rows, repo, reports, waiting } = setup();
    await waiting();
    repo.expirePending = async (id) => {
      Object.assign(
        rows.find((r) => r.id === id)!,
        {
          status: "resolved",
          verdict: "allow_once",
          decidedBy: "owner-1",
        },
      );
      return false;
    };

    await reports.ended(AGENT, { sessionId: SESSION, rpcId: RPC });

    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "allow_once",
      deliveredAt: expect.any(Date),
    });
  });

  // TEST_SCENARIO: a watched client answers, but the runtime dropped that answer: nothing reached the harness, and Home's earlier verdict still waits for delivery. The client's own reply is not proof that the request is over, so it must not close the delivery.
  it("keeps a lost delivery open when a client reply is not acknowledged", async () => {
    const { rows, relay, repo, waiting } = setup();
    await waiting();
    await repo.resolvePending(ROW, "deny_once", "owner-1");

    await relay.resolveAcpNativeFromInSession(ROW, {
      outcome: "selected",
      optionId: "allow",
    });

    expect(rows[0]).toMatchObject({
      status: "resolved",
      verdict: "deny_once",
      deliveredAt: null,
    });
  });
});
