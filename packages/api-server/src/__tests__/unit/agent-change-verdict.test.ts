import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { ApiContext, UserIdentity } from "api-server-api";
import { composeAgentChangeReplay } from "../../apps/api-server/trpc/agent-change-replay.js";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";

/**
 * TEST_OVERVIEW: the verdict on a change an assistant asked for. It is answered
 * by the owner in a signed-in session and nobody else — an API key, the
 * assistant's own token and an editor standing are all refused, the approval
 * service and the replay both. Then everything a token was checked for at mint
 * is re-read at the verdict, the row must still be unexpired to run, and the
 * replay composes the owner's own context rather than a widened copy.
 */

const OWNER: UserIdentity = {
  sub: "owner-1",
  preferredUsername: "owner-1",
  scopes: [
    "agents:read",
    "agents:operate",
    "agents:manage",
    "credentials:read",
  ],
  agentIds: "*",
};

function world(opts: { expiresAt?: Date } = {}) {
  const rows: PendingApprovalRow[] = [
    {
      id: "agentchange:1",
      type: "agent_change",
      agentId: "agent-assistant",
      ownerSub: OWNER.sub,
      sessionId: null,
      payload: {
        kind: "agent_change",
        procedure: "agents.update",
        title: "Change an Agent's settings",
        detail: '{"id":"agent-1","name":"renamed"}',
        input: { id: "agent-1", name: "renamed" },
      },
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 60_000),
      resolvedAt: null,
      verdict: null,
      decidedBy: null,
      status: "pending",
      deliveredAt: null,
    },
  ];
  const repo = {
    getPending: async (id: string) => rows.find((r) => r.id === id) ?? null,
    setPayload: async (id: string, payload: unknown) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.payload = payload as PendingApprovalRow["payload"];
    },
    resolvePending: async (
      id: string,
      verdict: PendingApprovalRow["verdict"],
      decidedBy: string,
      o?: { requireUnexpired?: boolean },
    ) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      if (o?.requireUnexpired === true && row.expiresAt.getTime() <= Date.now())
        return false;
      Object.assign(row, {
        status: "resolved",
        verdict,
        decidedBy,
        resolvedAt: new Date(),
      });
      return true;
    },
    markDelivered: async () => {},
  } as Partial<ApprovalsRepository> as ApprovalsRepository;

  const ran: unknown[] = [];
  const service = (
    caller: UserIdentity,
    extra: {
      allowed?: boolean;
      replay?: (payload: {
        procedure: string;
        input: unknown;
      }) => Promise<never>;
    } = {},
  ) =>
    createApprovalsService({
      repo,
      ownerSub: caller.sub,
      actor: caller.actingEditor ?? caller.sub,
      actorEmail: null,
      agentBinding: caller.agentIds,
      isAgentOwnedBy: async () => true,
      egressRuleWriter: {
        insert: async () => {
          throw new Error("a change writes no egress rule");
        },
      },
      wrapperFrameSender: { send: async () => {} },
      interactiveOwner:
        caller.keyId === undefined &&
        caller.onBehalfAgentId === undefined &&
        caller.actingEditor === undefined,
      assistantStillAllowed: async () =>
        extra.allowed === false
          ? { ok: false as const, reason: "the assistant is gone" }
          : { ok: true as const },
      executeAgentChange: async (payload) => {
        ran.push(payload.input);
        return { procedure: payload.procedure, status: "ran", error: null };
      },
    });

  return { rows, repo, ran, service };
}

describe("who may answer a change", () => {
  const callers: [string, UserIdentity][] = [
    ["an API key", { ...OWNER, keyId: "key-1" }],
    [
      "the assistant's own token",
      { ...OWNER, onBehalfAgentId: "agent-assistant" },
    ],
    ["an editor standing", { ...OWNER, actingEditor: "editor-1" }],
  ];

  for (const [who, caller] of callers) {
    it(`refuses the approving verdict from ${who}`, async () => {
      const w = world();
      const error = await w
        .service(caller)
        .approveOnce("agentchange:1")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
      expect(w.ran).toEqual([]);
      expect(w.rows[0]!.status).toBe("pending");
    });

    it(`refuses a refusal from ${who} too`, async () => {
      const w = world();
      const error = await w
        .service(caller)
        .dismiss("agentchange:1")
        .catch((e: unknown) => e);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
      expect(w.rows[0]!.status).toBe("pending");
    });
  }

  it("runs it for the owner's own session", async () => {
    const w = world();
    const outcome = await w.service(OWNER).approveOnce("agentchange:1");
    expect(outcome.agentChange).toMatchObject({ status: "ran" });
    expect(w.ran).toEqual([{ id: "agent-1", name: "renamed" }]);
  });
});

describe("what the verdict re-reads", () => {
  it("refuses to run once the assistant is no longer eligible", async () => {
    const w = world();
    const error = await w
      .service(OWNER, { allowed: false })
      .approveOnce("agentchange:1")
      .catch((e: unknown) => e);
    expect((error as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect((error as TRPCError).message).toContain("the assistant is gone");
    expect(w.ran).toEqual([]);
  });

  it("runs nothing for a row that expired before the verdict", async () => {
    const w = world({ expiresAt: new Date(Date.now() - 1_000) });
    expect(await w.service(OWNER).approveOnce("agentchange:1")).toEqual({
      outcome: "not_actionable",
      type: null,
      rule: null,
      agentChange: null,
    });
    expect(w.ran).toEqual([]);
  });
});

describe("the replay", () => {
  const payload = {
    kind: "agent_change" as const,
    procedure: "agents.update",
    title: "Change an Agent's settings",
    detail: "{}",
    input: { id: "agent-1", name: "renamed" },
  };

  it("composes the owner's own context, with the scopes and binding they signed in with", async () => {
    const composed: UserIdentity[] = [];
    const replay = composeAgentChangeReplay({
      contextFor: (user) => {
        composed.push(user);
        return {} as ApiContext;
      },
      user: OWNER,
      surface: "ui",
    });
    // UNIT_BOUNDARY_DESCRIPTION: no app router procedure is reachable from an empty context, so the call fails at the procedure; what this asserts is the identity the context was composed for.
    await replay(payload).catch(() => {});
    expect(composed).toEqual([OWNER]);
    expect(composed[0]).not.toHaveProperty("keyId");
    expect(composed[0]!.scopes).toBe(OWNER.scopes);
    expect(composed[0]!.agentIds).toBe(OWNER.agentIds);
  });

  it("composes nothing for an API key, an assistant token or an editor", async () => {
    for (const caller of [
      { ...OWNER, keyId: "key-1" },
      { ...OWNER, onBehalfAgentId: "agent-assistant" },
      { ...OWNER, actingEditor: "editor-1" },
    ]) {
      let composed = 0;
      const replay = composeAgentChangeReplay({
        contextFor: () => {
          composed += 1;
          return {} as ApiContext;
        },
        user: caller,
        surface: "ui",
      });
      expect(await replay(payload)).toMatchObject({ status: "failed" });
      expect(composed).toBe(0);
    }
  });
});
