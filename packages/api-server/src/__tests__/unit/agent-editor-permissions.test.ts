// TEST_OVERVIEW: An Agent Editor changes a Shared Agent's set-up through the same procedures as its owner. Each agent-scoped procedure names the Agent Permission it needs. An editor holding it runs the procedure in a context made for the Agent's owner, bound to that one Agent and naming the editor, because the Agent runs on the owner's budget, connections and skill library. An editor without it is refused with FORBIDDEN, and the service is never reached. Owners, API keys and strangers keep their own context, so their answers do not change. A procedure that names only a schedule, an Egress Rule or an Environment acts on the Agent that record belongs to.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPermission, ApiContext, UserIdentity } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { createActOnAgent } from "../../apps/api-server/trpc/act-on-agent.js";
import { createAgentTargetResolver } from "../../apps/api-server/trpc/agent-target.js";
import { createEditorRuntimeAccess } from "../../apps/api-server/agent-proxies/editor-runtime-access.js";
import { configureLogger } from "../../core/logger.js";

const OWNER = "alice";
const EDITOR_EMAIL = "bob@example.com";

const EDITS: AgentPermission[] = [
  "view",
  "settings",
  "envVars",
  "lifecycle",
  "spendLimits",
  "egressRules",
  "skills",
  "schedules",
  "chatForms",
  "environments",
];

const person = (sub: string, email: string): UserIdentity => ({
  sub,
  preferredUsername: sub,
  scopes: ["agents:manage", "credentials:manage"],
  agentIds: "*",
  email,
  emailVerified: true,
});

const BOB = person("bob", EDITOR_EMAIL);

const SCHEDULES: Record<string, { agentId: string }> = {
  "sched-1": { agentId: "alice-bot" },
  "sched-2": { agentId: "alice-bot" },
  "sched-other": { agentId: "alice-other" },
};

const resolveTarget = createAgentTargetResolver({
  schedules: { getById: async (id) => SCHEDULES[id] ?? null },
  egressRules: {
    getById: async (id) => (id === "rule-1" ? { agentId: "alice-bot" } : null),
  },
  environments: {
    get: async (id) => (id === "env-1" ? { owningAgentId: "alice-bot" } : null),
  },
});

const editorOf: Record<string, string[]> = {
  "alice-bot": [EDITOR_EMAIL],
  "alice-other": [],
};

async function standing(
  agentId: string,
  caller: { sub: string; editorEmail: string },
) {
  if (caller.sub === OWNER) return null;
  if (!(editorOf[agentId] ?? []).includes(caller.editorEmail)) return null;
  return { ownerSub: OWNER, permissions: EDITS };
}

function world(user: UserIdentity) {
  const madeFor: UserIdentity[] = [];
  const ownerServices = {
    schedules: { runNow: vi.fn(async () => ({ queued: true })) },
    egressRules: { revoke: vi.fn(async () => undefined) },
    agents: { delete: vi.fn(async () => undefined) },
  };
  const callerServices = {
    schedules: { runNow: vi.fn(async () => ({ queued: true })) },
    egressRules: { revoke: vi.fn(async () => undefined) },
    agents: { delete: vi.fn(async () => undefined), update: vi.fn() },
    connections: { updateAgentConnections: vi.fn() },
  };
  const ownerCtx = { ...ownerServices } as unknown as ApiContext;
  const ctx = {
    ...callerServices,
    user,
    actOnAgent: createActOnAgent({
      user,
      self: () => ctx,
      agentOfTarget: resolveTarget,
      editorStanding: standing,
      contextFor: (identity) => {
        madeFor.push(identity);
        return { ...ownerCtx, user: identity };
      },
    }),
  } as unknown as ApiContext;
  markTermsProven(ctx);
  return {
    caller: appRouter.createCaller(ctx),
    ctx,
    ownerServices,
    callerServices,
    madeFor,
  };
}

let logLines: string[] = [];
beforeEach(() => {
  logLines = [];
  configureLogger({ level: "info", write: (line) => logLines.push(line) });
});
afterEach(() => configureLogger({ level: "info" }));

const audit = () =>
  logLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.msg === "agent.editor_act");

describe("an editor acting on a shared agent", () => {
  // TEST_SCENARIO: An editor pauses or runs a schedule of the shared agent. The call runs against the owner's schedules, in a context bound to that one agent and naming the editor; the editor's own schedules are not touched, and the audit names the editor, the owner and the procedure.
  it("runs a permitted change in the owner's context, bound to the agent", async () => {
    const w = world(BOB);
    await w.caller.schedules.runNow({ id: "sched-1" });

    expect(w.ownerServices.schedules.runNow).toHaveBeenCalledWith("sched-1");
    expect(w.callerServices.schedules.runNow).not.toHaveBeenCalled();
    expect(w.madeFor).toEqual([
      expect.objectContaining({
        sub: OWNER,
        agentIds: ["alice-bot"],
        actingEditor: "bob",
      }),
    ]);
    expect(audit()).toEqual([
      expect.objectContaining({
        actor: "bob",
        agentId: "alice-bot",
        result: "success",
        detail: {
          ownerSub: OWNER,
          permission: "schedules",
          procedure: "schedules.runNow",
        },
      }),
    ]);
  });

  // TEST_SCENARIO: A procedure that names only an Egress Rule acts on the agent the rule belongs to, so the editor revokes a rule of the shared agent as its owner would.
  it("finds the agent from a rule id", async () => {
    const w = world(BOB);
    await w.caller.egressRules.revoke({ id: "rule-1" });
    expect(w.ownerServices.egressRules.revoke).toHaveBeenCalledWith("rule-1");
  });

  // TEST_SCENARIO: Deleting the agent, its whisper switch and its connections stay with the owner. The editor is told so with FORBIDDEN, not NOT_FOUND, no service is reached, and the refusal is an audit record.
  it.each([
    {
      procedure: "agents.delete",
      call: (c: ReturnType<typeof world>["caller"]) =>
        c.agents.delete({ id: "alice-bot" }),
    },
    {
      procedure: "agents.setWhisper",
      call: (c: ReturnType<typeof world>["caller"]) =>
        c.agents.setWhisper({ id: "alice-bot", whisper: false }),
    },
    {
      procedure: "connections.updateAgentConnections",
      call: (c: ReturnType<typeof world>["caller"]) =>
        c.connections.updateAgentConnections({
          agentId: "alice-bot",
          grant: ["conn-1"],
          revoke: [],
        }),
    },
  ])("refuses $procedure to an editor", async ({ procedure, call }) => {
    const w = world(BOB);
    await expect(call(w.caller)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(w.madeFor).toEqual([]);
    expect(w.ownerServices.agents.delete).not.toHaveBeenCalled();
    expect(w.callerServices.agents.delete).not.toHaveBeenCalled();
    expect(w.callerServices.agents.update).not.toHaveBeenCalled();
    expect(
      w.callerServices.connections.updateAgentConnections,
    ).not.toHaveBeenCalled();
    expect(audit()).toEqual([
      expect.objectContaining({
        actor: "bob",
        result: "failure",
        detail: expect.objectContaining({ procedure }),
      }),
    ]);
  });
});

describe("everyone who is not an editor", () => {
  // TEST_SCENARIO: The owner, a person with no verified email, an API key and a stranger keep their own context. Their own owner-scoped services answer exactly as before this check existed, and nothing is audited.
  it.each([
    { label: "the owner", user: person(OWNER, "alice@example.com") },
    {
      label: "a person with an unverified email",
      user: { ...BOB, emailVerified: false },
    },
    { label: "an API key", user: { ...BOB, keyId: "key-1" } },
    { label: "a stranger", user: person("carol", "carol@example.com") },
  ])("runs as $label", async ({ user }) => {
    const w = world(user);
    await w.caller.schedules.runNow({ id: "sched-1" });
    await w.caller.agents.delete({ id: "alice-bot" });

    expect(w.callerServices.schedules.runNow).toHaveBeenCalledWith("sched-1");
    expect(w.callerServices.agents.delete).toHaveBeenCalledWith("alice-bot");
    expect(w.madeFor).toEqual([]);
    expect(audit()).toEqual([]);
  });

  // TEST_SCENARIO: Schedules handed over together that belong to different agents, or a schedule that is gone, name no single agent. The call runs as the caller, whose owner-scoped service refuses what is not theirs.
  it("runs as the caller when the schedules span agents", async () => {
    expect(
      await resolveTarget({
        kind: "schedules",
        scheduleIds: ["sched-1", "sched-other"],
      }),
    ).toBeNull();
    expect(
      await resolveTarget({
        kind: "schedules",
        scheduleIds: ["sched-1", "sched-gone"],
      }),
    ).toBeNull();
    expect(
      await resolveTarget({
        kind: "schedules",
        scheduleIds: ["sched-1", "sched-2"],
      }),
    ).toBe("alice-bot");
    expect(
      await resolveTarget({ kind: "environment", environmentId: "env-1" }),
    ).toBe("alice-bot");
  });
});

describe("an editor reaching the shared agent's runtime", () => {
  const runtime = createEditorRuntimeAccess({ editorStanding: standing });
  const call = (paths: string[], mutation = false) => ({ paths, mutation });

  // TEST_SCENARIO: The agent's page reads live model settings and the pending restart from the agent's own runtime. An editor reaches those calls, alone or batched, and applies a pending restart, which is audited.
  it("lets an editor read model settings and apply a pending restart", async () => {
    expect(
      await runtime(
        "alice-bot",
        BOB,
        call(["harnessConfig.current", "harnessConfig.models"]),
      ),
    ).toBe(true);
    expect(
      await runtime(
        "alice-bot",
        BOB,
        call(["processes.applyPendingRestart"], true),
      ),
    ).toBe(true);
    expect(audit()).toEqual([
      expect.objectContaining({
        actor: "bob",
        detail: {
          ownerSub: OWNER,
          procedure: "processes.applyPendingRestart",
        },
      }),
    ]);
  });

  // TEST_SCENARIO: Sessions, files and anything else on the runtime stay with the owner until editors get sessions. A batch that hides one of them among allowed calls is refused whole, and a stranger reaches nothing.
  it("refuses everything else", async () => {
    expect(await runtime("alice-bot", BOB, call(["sessions.list"]))).toBe(
      false,
    );
    expect(
      await runtime(
        "alice-bot",
        BOB,
        call(["harnessConfig.current", "files.read"]),
      ),
    ).toBe(false);
    expect(
      await runtime(
        "alice-bot",
        person("carol", "carol@example.com"),
        call(["harnessConfig.current"]),
      ),
    ).toBe(false);
  });
});
