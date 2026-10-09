import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Subscription } from "rxjs";
import { acpNativeRowId } from "api-server-api";

import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsRelayService } from "../../modules/approvals/services/approvals-relay-service.js";
import type { RedisBus } from "../../core/redis-bus.js";
import { EventType, events$, type DomainEvent } from "../../events.js";

// TEST_OVERVIEW: the relay mirrors in-session ACP permission prompts into pending_approvals. A prompt re-sent under a new rpc id (a reload re-attaches the session) must not leave the earlier row pending, and an in-session answer must record the verdict of the option the user chose.

const AGENT = "agent-1";
const SESSION = "sess-1";
const OPTIONS = [
  { optionId: "allow", kind: "allow_once" as const },
  { optionId: "allow-all", kind: "allow_always" as const },
  { optionId: "no", kind: "reject_once" as const },
  { optionId: "never", kind: "reject_always" as const },
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
    listPendingForInstance: async (agentId, opts) =>
      rows.filter(
        (r) =>
          r.agentId === agentId && (!opts?.status || r.status === opts.status),
      ),
    resolvePending: async (id, verdict, decidedBy) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      Object.assign(row, { status: "resolved", verdict, decidedBy });
      return true;
    },
    expirePending: async (id) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (row) row.status = "expired";
    },
  } as Partial<ApprovalsRepository> as ApprovalsRepository;
  return { rows, repo };
}

function setup() {
  const { rows, repo } = makeRepo();
  const service = createApprovalsRelayService({
    repo,
    bus: {} as RedisBus,
  });
  const record = (rpcId: string, toolCallId: string) =>
    service.recordAcpNativePending({
      agentId: AGENT,
      sessionId: SESSION,
      rpcId,
      ownerSub: "owner-1",
      toolName: "Write /tmp/a",
      toolCallId,
      args: { path: "/tmp/a" },
      options: OPTIONS,
    });
  return { rows, service, record };
}

let events: DomainEvent[] = [];
let sub: Subscription;
beforeEach(() => {
  events = [];
  sub = events$().subscribe((e) => events.push(e));
});
afterEach(() => sub.unsubscribe());

describe("recordAcpNativePending", () => {
  // TEST_SCENARIO: QA repro — a reload re-sends the open prompt as platform-lease-in-4; the row mirrored for platform-lease-in-3 must stop counting as waiting.
  it("expires the row of the same tool call mirrored under an earlier rpc id", async () => {
    const { rows, record } = setup();
    await record("platform-lease-in-3", "tc-1");
    await record("platform-lease-in-4", "tc-1");

    const stale = acpNativeRowId(AGENT, SESSION, "platform-lease-in-3");
    expect(rows.find((r) => r.id === stale)?.status).toBe("expired");
    expect(
      rows.find(
        (r) => r.id === acpNativeRowId(AGENT, SESSION, "platform-lease-in-4"),
      )?.status,
    ).toBe("pending");
    expect(
      events.some(
        (e) => e.type === EventType.ApprovalResolved && e.approvalId === stale,
      ),
    ).toBe(true);
  });

  // TEST_SCENARIO: two distinct tool calls waiting in one session are both real prompts.
  it("keeps the rows of other tool calls pending", async () => {
    const { rows, record } = setup();
    await record("1", "tc-1");
    await record("2", "tc-2");
    expect(rows.map((r) => r.status)).toEqual(["pending", "pending"]);
  });
});

describe("resolveAcpNativeFromInSession", () => {
  // TEST_SCENARIO: each chosen option records its own verdict, and a cancelled prompt records a denial, not an allow.
  it.each([
    [{ outcome: "selected", optionId: "allow" }, "allow_once"],
    [{ outcome: "selected", optionId: "allow-all" }, "allow"],
    [{ outcome: "selected", optionId: "no" }, "deny_once"],
    [{ outcome: "selected", optionId: "never" }, "deny"],
    [{ outcome: "cancelled" }, "deny_once"],
  ])("records %o as %s", async (outcome, verdict) => {
    const { rows, service, record } = setup();
    const rowId = await record("7", "tc-1");
    await service.resolveAcpNativeFromInSession(rowId!, outcome);
    expect(rows[0]).toMatchObject({ status: "resolved", verdict });
  });
});
