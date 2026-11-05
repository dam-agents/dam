import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import type { ApiContext, UserIdentity } from "api-server-api";
import {
  agentChangeProcedurePaths,
  isClassifiedAgentChange,
} from "api-server-api";
import { appRouter } from "api-server-api/router";
import { t } from "api-server-api/trpc";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";
import { createAgentChangeApprovals } from "../../modules/approvals/services/agent-change-approvals.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";

/**
 * TEST_OVERVIEW: an assistant's token may read and create, and nothing else. A
 * change is filed on the owner's queue instead of running; the owner's approve
 * runs it exactly once and writes what became of it on the row; a refusal runs
 * nothing; and the verdicts this platform gives to a person are refused
 * outright. Every tRPC mutation must have a verdict, so a procedure added later
 * cannot slip through unclassified.
 */

const OBO: UserIdentity = {
  sub: "owner-1",
  preferredUsername: "owner-1",
  scopes: [
    "agents:read",
    "agents:operate",
    "agents:manage",
    "credentials:read",
  ],
  agentIds: "*",
  onBehalfAgentId: "agent-assistant",
};

const PERSON: UserIdentity = { ...OBO, onBehalfAgentId: undefined };

function world() {
  const filed: {
    procedure: string;
    input: unknown;
  }[] = [];
  const rows: PendingApprovalRow[] = [];
  const repo = {
    insertPending: async (row) => {
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
    setPayload: async (id, payload) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.payload = payload;
    },
    resolvePending: async (id, verdict, decidedBy) => {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      Object.assign(row, {
        status: "resolved",
        verdict,
        decidedBy,
        resolvedAt: new Date(),
      });
      return true;
    },
  } as Partial<ApprovalsRepository> as ApprovalsRepository;

  const agentChanges = createAgentChangeApprovals({
    repo,
    agentId: OBO.onBehalfAgentId,
    ownerSub: OBO.sub,
    actor: OBO.sub,
  });
  const record = agentChanges.request.bind(agentChanges);
  agentChanges.request = async (change) => {
    filed.push(change);
    const filedChange = await record(change);
    return filedChange;
  };

  const ran: unknown[] = [];
  const approvals = createApprovalsService({
    repo,
    egressRuleWriter: {
      insert: async () => {
        throw new Error("no egress rule is written by a change approval");
      },
    },
    wrapperFrameSender: { send: async () => {} },
    isAgentOwnedBy: async () => true,
    ownerSub: OBO.sub,
    actor: OBO.sub,
    actorEmail: null,
    agentBinding: "*",
    interactiveOwner: true,
    executeAgentChange: async (payload) => {
      ran.push(payload.input);
      return { procedure: payload.procedure, status: "ran", error: null };
    },
  });
  return { agentChanges, approvals, rows, filed, ran, repo };
}

function contextOf(agentChanges: ApiContext["agentChanges"], user = OBO) {
  return {
    user,
    agentChanges,
    terms: { isAccepted: async () => true },
  } as unknown as ApiContext;
}

const router = t.router({
  agents: t.router({
    create: t.procedure
      .input(
        z.object({
          name: z.string(),
          connectionIds: z.array(z.string()).optional(),
          secretRef: z.string().optional(),
        }),
      )
      .mutation(({ input }) => input),
    update: t.procedure
      .input(z.object({ id: z.string(), name: z.string().optional() }))
      .mutation(({ input }) => input),
    setEditors: t.procedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => input),
  }),
});

describe("the change gate", () => {
  it("lets a create run at once and files nothing", async () => {
    const w = world();
    const caller = router.createCaller(contextOf(w.agentChanges));
    await expect(caller.agents.create({ name: "notes" })).resolves.toEqual({
      name: "notes",
    });
    expect(w.filed).toEqual([]);
  });

  it("holds a create that would grant something to the new Agent", async () => {
    const w = world();
    const caller = router.createCaller(contextOf(w.agentChanges));
    const error = (await caller.agents
      .create({ name: "notes", connectionIds: ["conn-1"] })
      .catch((e: unknown) => e)) as TRPCError;
    expect(error.code).toBe("PRECONDITION_FAILED");
    expect(w.filed).toEqual([
      {
        procedure: "agents.create",
        input: { name: "notes", connectionIds: ["conn-1"] },
      },
    ]);
  });

  it("holds a create that names a shared Secret", async () => {
    const w = world();
    const caller = router.createCaller(contextOf(w.agentChanges));
    const error = (await caller.agents
      .create({ name: "notes", secretRef: "my-secret" })
      .catch((e: unknown) => e)) as TRPCError;
    expect(error.code).toBe("PRECONDITION_FAILED");
  });

  it("holds a reinstall of a skill, which replaces an installation that exists", async () => {
    const w = world();
    const caller = appRouter.createCaller(contextOf(w.agentChanges));
    const error = (await caller.skills
      .install({
        agentId: "agent-1",
        source: "https://github.com/dam-agents/skills",
        name: "review",
        version: "1.2.0",
      } as never)
      .catch((e: unknown) => e)) as TRPCError;
    expect(error.code).toBe("PRECONDITION_FAILED");
    expect(w.filed.map((f) => f.procedure)).toEqual(["skills.install"]);
  });

  it("files the procedure's own canonical arguments, not the raw ones", async () => {
    const w = world();
    const caller = appRouter.createCaller(contextOf(w.agentChanges));

    // UNIT_BOUNDARY_DESCRIPTION: egressRules.create fills its method and path from defaults the procedure's schema owns, so what the owner reads is what would run.
    const egressError = await caller.egressRules
      .create({
        agentId: "agent-1",
        host: "api.example.com",
        verdict: "allow",
      } as never)
      .catch((e: unknown) => e);
    expect(egressError).toBeInstanceOf(TRPCError);
    expect(w.filed[0]!.input).toMatchObject({
      agentId: "agent-1",
      host: "api.example.com",
      method: "*",
      pathPattern: "*",
      verdict: "allow",
    });

    // UNIT_BOUNDARY_DESCRIPTION: a key the schema does not declare is gone before the owner ever sees it.
    await caller.agents
      .update({ id: "agent-1", name: "renamed", sketchy: true } as never)
      .catch(() => {});
    expect(w.filed[1]!.input).toEqual({ id: "agent-1", name: "renamed" });
  });

  it("holds a rename, files it with the owner, and does not run it", async () => {
    const w = world();
    const caller = router.createCaller(contextOf(w.agentChanges));
    const error = await caller.agents
      .update({ id: "agent-1", name: "renamed" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect(w.filed).toEqual([
      { procedure: "agents.update", input: { id: "agent-1", name: "renamed" } },
    ]);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]!.payload).toMatchObject({
      kind: "agent_change",
      procedure: "agents.update",
      input: { id: "agent-1", name: "renamed" },
    });
  });

  it("tells the caller which approval to wait on", async () => {
    const w = world();
    const caller = router.createCaller(contextOf(w.agentChanges));
    const error = (await caller.agents
      .update({ id: "agent-1" })
      .catch((e: unknown) => e)) as TRPCError;
    expect(error.message).toContain("Waiting for your owner's approval");
    expect(error.message).toContain(w.rows[0]!.id);
    expect(error.cause).toMatchObject({
      pendingApproval: { id: w.rows[0]!.id, title: expect.any(String) },
    });
  });

  it("refuses outright a decision the platform gives to the person", async () => {
    const w = world();
    const caller = router.createCaller(contextOf(w.agentChanges));
    const error = (await caller.agents
      .setEditors({ id: "agent-1" })
      .catch((e: unknown) => e)) as TRPCError;
    expect(error.code).toBe("FORBIDDEN");
    expect(w.filed).toEqual([]);
  });

  it("never touches the gate for a person's own session", async () => {
    const w = world();
    const caller = router.createCaller(contextOf(w.agentChanges, PERSON));
    await expect(
      caller.agents.update({ id: "agent-1", name: "x" }),
    ).resolves.toEqual({ id: "agent-1", name: "x" });
    expect(w.filed).toEqual([]);
  });
});

describe("the owner's verdict", () => {
  const fileOne = async (w: ReturnType<typeof world>) => {
    const caller = router.createCaller(contextOf(w.agentChanges));
    await caller.agents
      .update({ id: "agent-1", name: "renamed" })
      .catch(() => {});
    return w.rows[0]!.id;
  };

  it("runs the held change once and records what became of it", async () => {
    const w = world();
    const id = await fileOne(w);
    const outcome = await w.approvals.approveOnce(id);
    expect(outcome.outcome).toBe("applied");
    expect(outcome.agentChange).toEqual({
      procedure: "agents.update",
      status: "ran",
      error: null,
    });
    expect(w.ran).toEqual([{ id: "agent-1", name: "renamed" }]);
    expect(w.rows[0]!.status).toBe("resolved");

    // UNIT_BOUNDARY_DESCRIPTION: a second verdict finds it settled and runs nothing.
    expect(await w.approvals.approveOnce(id)).toEqual({
      outcome: "not_actionable",
      type: null,
      rule: null,
      agentChange: null,
    });
    expect(w.ran).toHaveLength(1);
    const readBack = await w.approvals.get(id);
    expect(readBack?.payload).toMatchObject({
      outcome: { status: "ran" },
    });
  });

  it("runs nothing when the owner refuses", async () => {
    const w = world();
    const id = await fileOne(w);
    const outcome = await w.approvals.dismiss(id);
    expect(outcome.outcome).toBe("applied");
    expect(w.ran).toEqual([]);
    expect((await w.approvals.get(id))?.payload).not.toHaveProperty("outcome");
  });

  it("records a failure instead of losing it", async () => {
    const w = world();
    const id = await fileOne(w);
    const failing = createApprovalsService({
      repo: w.repo,
      egressRuleWriter: {
        insert: async () => {
          throw new Error("unused");
        },
      },
      wrapperFrameSender: { send: async () => {} },
      isAgentOwnedBy: async () => true,
      ownerSub: OBO.sub,
      actor: OBO.sub,
      actorEmail: null,
      agentBinding: "*",
      interactiveOwner: true,
      executeAgentChange: async () => {
        throw new Error("the schedule was deleted meanwhile");
      },
    });
    const outcome = await failing.approveOnce(id);
    expect(outcome.agentChange).toEqual({
      procedure: "agents.update",
      status: "failed",
      error: "the schedule was deleted meanwhile",
    });
    expect((await w.approvals.get(id))?.payload).toMatchObject({
      outcome: {
        status: "failed",
        error: "the schedule was deleted meanwhile",
      },
    });
  });
});

describe("the classification table", () => {
  const procedures = (
    appRouter as unknown as {
      _def: { procedures: Record<string, { _def: { type: string } }> };
    }
  )._def.procedures;

  it("has a verdict for every mutation procedure", () => {
    const unclassified = Object.entries(procedures)
      .filter(([, p]) => p._def.type === "mutation")
      .map(([path]) => path)
      .filter((path) => !isClassifiedAgentChange(path));
    expect(unclassified).toEqual([]);
  });

  it("classifies no procedure that is gone or is not a mutation", () => {
    const stale = agentChangeProcedurePaths().filter(
      (path) => procedures[path]?._def.type !== "mutation",
    );
    expect(stale).toEqual([]);
  });

  it("refuses the person's own decisions even where a scope would allow them", async () => {
    const w = world();
    const caller = appRouter.createCaller(contextOf(w.agentChanges));
    for (const call of [
      () => caller.apiKeys.create({ name: "x", scopes: ["agents:read"] }),
      () => caller.approvals.approveOnce({ id: "any" }),
      () => caller.terms.accept({ version: "1" }),
    ]) {
      const error = (await call().catch((e: unknown) => e)) as TRPCError;
      expect(error).toBeInstanceOf(TRPCError);
      expect(error.code).toBe("FORBIDDEN");
    }
    expect(w.filed).toEqual([]);
  });
});
