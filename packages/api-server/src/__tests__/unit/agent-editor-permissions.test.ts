// TEST_OVERVIEW: An Agent Editor changes a Shared Agent's set-up through the same procedures as its owner. Each agent-scoped procedure names the Agent Permission it needs. An editor holding it runs the procedure in a context made for the Agent's owner, bound to that one Agent and naming the editor, because the Agent runs on the owner's budget, connections and skill library. An editor without it is refused with FORBIDDEN, and the service is never reached. Owners, API keys and strangers keep their own context, so their answers do not change. A procedure that names only a schedule, an Egress Rule, an Environment or approvals acts on the Agent that record belongs to. Answering an approval also needs the permission of what it lets through.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentPermission,
  ApiContext,
  ApprovalType,
  UserIdentity,
} from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { createActOnAgent } from "../../apps/api-server/trpc/act-on-agent.js";
import { createAgentTargetResolver } from "../../apps/api-server/trpc/agent-target.js";
import {
  createEditorRuntimeAccess,
  editorMayCall,
} from "../../apps/api-server/agent-proxies/editor-runtime-access.js";
import { screenEditorFrame } from "../../apps/api-server/agent-proxies/editor-trpc-frames.js";
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
  "sessions",
];

const person = (sub: string, email: string): UserIdentity => ({
  sub,
  preferredUsername: sub,
  scopes: ["agents:manage", "agents:operate", "credentials:manage"],
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

const APPROVALS: Record<string, { agentId: string; type: ApprovalType }> = {
  "tool-call": { agentId: "alice-bot", type: "acp_native" },
  "network-access": { agentId: "alice-bot", type: "ext_authz" },
  "proposed-rule": { agentId: "alice-bot", type: "egress_proposal" },
  "spend-limit": { agentId: "alice-bot", type: "spend_limit" },
  "other-agent": { agentId: "alice-other", type: "acp_native" },
};

const resolveTarget = createAgentTargetResolver({
  schedules: { getById: async (id) => SCHEDULES[id] ?? null },
  egressRules: {
    getById: async (id) => (id === "rule-1" ? { agentId: "alice-bot" } : null),
  },
  environments: {
    get: async (id) => (id === "env-1" ? { owningAgentId: "alice-bot" } : null),
  },
  approvals: { getPending: async (id) => APPROVALS[id] ?? null },
});

const editorOf: Record<string, string[]> = {
  "alice-bot": [EDITOR_EMAIL],
  "alice-other": [],
};

let editorPermissions = EDITS;

async function standing(
  agentId: string,
  caller: { sub: string; editorEmail: string },
) {
  if (caller.sub === OWNER) return null;
  if (!(editorOf[agentId] ?? []).includes(caller.editorEmail)) return null;
  return { ownerSub: OWNER, permissions: editorPermissions };
}

function world(user: UserIdentity) {
  const madeFor: UserIdentity[] = [];
  const ownerServices = {
    schedules: { runNow: vi.fn(async () => ({ queued: true })) },
    egressRules: { revoke: vi.fn(async () => undefined) },
    agents: { delete: vi.fn(async () => undefined) },
    approvals: {
      approveOnce: vi.fn(async () => ({ outcome: "resolved" })),
      dismissMany: vi.fn(async () => ({ resolved: 0 })),
    },
  };
  const callerServices = {
    schedules: { runNow: vi.fn(async () => ({ queued: true })) },
    egressRules: { revoke: vi.fn(async () => undefined) },
    agents: { delete: vi.fn(async () => undefined), update: vi.fn() },
    connections: { updateAgentConnections: vi.fn() },
    approvals: {
      approveOnce: vi.fn(async () => ({ outcome: "not_actionable" })),
      dismissMany: vi.fn(async () => ({ resolved: 0 })),
    },
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
  editorPermissions = EDITS;
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

describe("an editor answering the shared agent's approvals", () => {
  // TEST_SCENARIO: An editor allows a tool call, or network access, of the shared agent. The answer runs in the owner's context, where the approval lives, and the audit names the permission the approval needed: sessions for a tool call, egressRules for network access.
  it.each([
    { id: "tool-call", needs: "view,sessions" },
    { id: "network-access", needs: "view,egressRules" },
  ])("answers $id as the owner would", async ({ id, needs }) => {
    const w = world(BOB);
    await w.caller.approvals.approveOnce({ id });

    expect(w.ownerServices.approvals.approveOnce).toHaveBeenCalledWith(id);
    expect(w.madeFor).toEqual([
      expect.objectContaining({ sub: OWNER, actingEditor: "bob" }),
    ]);
    expect(audit()).toEqual([
      expect.objectContaining({
        actor: "bob",
        result: "success",
        detail: expect.objectContaining({ permission: needs }),
      }),
    ]);
  });

  // TEST_SCENARIO: An editor who does not hold the permission an approval needs is refused with FORBIDDEN before the approvals service runs.
  it("refuses an approval whose permission the editor lacks", async () => {
    editorPermissions = EDITS.filter((p) => p !== "sessions");
    const w = world(BOB);
    await expect(
      w.caller.approvals.approveOnce({ id: "tool-call" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(w.ownerServices.approvals.approveOnce).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: Continuing a spend limit raises the owner's own spending, so it has no target. The editor runs as themselves, and the owner-scoped service finds nothing of theirs to answer.
  it("leaves a spend limit question to the owner", async () => {
    const w = world(BOB);
    await w.caller.approvals.approveOnce({ id: "spend-limit" });

    expect(w.callerServices.approvals.approveOnce).toHaveBeenCalledWith(
      "spend-limit",
    );
    expect(w.ownerServices.approvals.approveOnce).not.toHaveBeenCalled();
    expect(w.madeFor).toEqual([]);
  });

  // TEST_SCENARIO: Approvals denied together act on one agent only, and need every permission their kinds need. A list that spans agents or holds a spend limit question names no agent.
  it("resolves approvals handed over together", async () => {
    expect(
      await resolveTarget({
        kind: "approvals",
        approvalIds: ["tool-call", "proposed-rule", "network-access"],
      }),
    ).toEqual({ agentId: "alice-bot", needs: ["sessions", "egressRules"] });
    expect(
      await resolveTarget({
        kind: "approvals",
        approvalIds: ["tool-call", "other-agent"],
      }),
    ).toBeNull();
    expect(
      await resolveTarget({
        kind: "approvals",
        approvalIds: ["tool-call", "spend-limit"],
      }),
    ).toBeNull();
    expect(
      await resolveTarget({ kind: "approvals", approvalIds: ["gone"] }),
    ).toBeNull();
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
    ).toEqual({ agentId: "alice-bot", needs: [] });
    expect(
      await resolveTarget({ kind: "environment", environmentId: "env-1" }),
    ).toEqual({ agentId: "alice-bot", needs: [] });
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

  // TEST_SCENARIO: The session screen and its side panels reach the runtime for sessions, files, the browser, changes and a turn's processes. An editor who holds sessions reaches all of them.
  it("lets an editor use the session screen", async () => {
    expect(
      await runtime(
        "alice-bot",
        BOB,
        call([
          "sessions.list",
          "files.read",
          "changes.diff",
          "processes.output",
        ]),
      ),
    ).toBe(true);
    expect(
      await runtime("alice-bot", BOB, call(["browser.navigate"], true)),
    ).toBe(true);
  });

  // TEST_SCENARIO: SSH keys, publishing and the platform's own runtime calls stay with the owner. A batch that hides one of them among allowed calls is refused whole, and a stranger reaches nothing.
  it("refuses everything else", async () => {
    expect(
      await runtime("alice-bot", BOB, call(["ssh.authorizeKey"], true)),
    ).toBe(false);
    expect(
      await runtime(
        "alice-bot",
        BOB,
        call(["harnessConfig.current", "kbPublish.sync"]),
      ),
    ).toBe(false);
    expect(
      await runtime("alice-bot", BOB, call(["runtime.v1.applyState"], true)),
    ).toBe(false);
    expect(
      await runtime(
        "alice-bot",
        person("carol", "carol@example.com"),
        call(["harnessConfig.current"]),
      ),
    ).toBe(false);
  });

  // TEST_SCENARIO: tRPC decodes the URL path before it splits a batch on commas, so "files.x%2Cssh.authorizeKey" runs ssh.authorizeKey. A path with a character a procedure name cannot have is refused, even under a namespace the editor may use.
  it("refuses a procedure hidden by an escaped comma", async () => {
    expect(
      await runtime(
        "alice-bot",
        BOB,
        call(["files.x%2Cssh.authorizeKey"], true),
      ),
    ).toBe(false);
    expect(await runtime("alice-bot", BOB, call(["sessions.list%2C"]))).toBe(
      false,
    );
  });
});

describe("an editor on the runtime's tRPC socket", () => {
  const mayCall = (path: string) => editorMayCall(EDITS, path);

  // TEST_SCENARIO: The socket carries one call or a batch of calls in a message. Calls the editor may make pass unchanged, so the runtime answers them as for the owner.
  it("passes calls the editor may make", () => {
    const frame = JSON.stringify([
      { id: 1, method: "query", params: { path: "sessions.list", input: {} } },
      { id: 2, method: "subscription.stop" },
    ]);
    expect(screenEditorFrame(frame, mayCall)).toEqual({
      forward: frame,
      refusals: [],
      mutations: [],
    });
    expect(screenEditorFrame("PING", mayCall).forward).toBe("PING");
  });

  // TEST_SCENARIO: A call the editor may not make is taken out of the message and answered with a FORBIDDEN error for its id, so the client's call fails as it would over HTTP, and the rest of the batch still reaches the runtime.
  it("answers a refused call and forwards the rest", () => {
    const screened = screenEditorFrame(
      JSON.stringify([
        {
          id: 1,
          jsonrpc: "2.0",
          method: "mutation",
          params: { path: "ssh.authorizeKey", input: {} },
        },
        { id: 2, method: "mutation", params: { path: "files.write" } },
      ]),
      mayCall,
    );
    expect(JSON.parse(screened.forward!)).toEqual([
      { id: 2, method: "mutation", params: { path: "files.write" } },
    ]);
    expect(screened.mutations).toEqual(["files.write"]);
    expect(screened.refusals.map((r) => JSON.parse(r))).toEqual([
      {
        id: 1,
        jsonrpc: "2.0",
        error: expect.objectContaining({
          code: -32003,
          data: expect.objectContaining({
            code: "FORBIDDEN",
            path: "ssh.authorizeKey",
          }),
        }),
      },
    ]);
  });

  // TEST_SCENARIO: A message whose only call is refused sends nothing to the runtime.
  it("forwards nothing when every call is refused", () => {
    const screened = screenEditorFrame(
      JSON.stringify({
        id: 3,
        method: "subscription",
        params: { path: "kbPublish.sync" },
      }),
      mayCall,
    );
    expect(screened.forward).toBeNull();
    expect(screened.refusals).toHaveLength(1);
  });
});
