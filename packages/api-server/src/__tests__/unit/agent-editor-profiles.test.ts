// TEST_OVERVIEW: The profile set an agent can reference is its owner's. A call made from an agent re-binds the Agent's owner as the acting user, so an Agent Editor lists and changes the owner's profiles and the reference it picks resolves against the owner's set; the editor's own profiles are never the ones a shared agent sees.
import { describe, expect, it, vi } from "vitest";
import type { AgentPermission, ApiContext, UserIdentity } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { createActOnAgent } from "../../apps/api-server/trpc/act-on-agent.js";
import { createAgentTargetResolver } from "../../apps/api-server/trpc/agent-target.js";

const OWNER = "alice";
const EDITOR_EMAIL = "bob@example.com";
const AGENT = "alice-bot";

const EDITS: AgentPermission[] = ["view", "settings"];

const person = (sub: string, email: string): UserIdentity => ({
  sub,
  preferredUsername: sub,
  scopes: ["agents:manage", "agents:operate"],
  agentIds: "*",
  email,
  emailVerified: true,
});

const BOB = person("bob", EDITOR_EMAIL);

const resolveTarget = createAgentTargetResolver({
  schedules: { getById: async () => null },
  egressRules: { getById: async () => null },
  environments: { get: async () => null },
  approvals: { getPending: async () => null },
});

const editorOf: Record<string, string[]> = { [AGENT]: [EDITOR_EMAIL] };
let editorPermissions = EDITS;

async function standing(
  agentId: string,
  caller: { sub: string; editorEmail: string },
) {
  if (caller.sub === OWNER) return null;
  if (!(editorOf[agentId] ?? []).includes(caller.editorEmail)) return null;
  return { ownerSub: OWNER, permissions: editorPermissions };
}

const PROFILE = {
  id: "profile-owner",
  name: "Default",
  harness: "claude-code",
  providerTemplate: "curve-bender-deployment",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  settings: {},
  seeded: true,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  usage: { agents: 1, channels: 0, schedules: 0 },
  availability: null,
};

function world(user: UserIdentity) {
  const madeFor: UserIdentity[] = [];
  const ownerProfiles = {
    list: vi.fn(async () => [PROFILE]),
    usage: vi.fn(async () => ({ agents: [], channels: [], schedules: [] })),
    create: vi.fn(async () => PROFILE),
    update: vi.fn(async () => ({ profile: PROFILE, rejected: [] })),
    delete: vi.fn(async () => undefined),
  };
  const ownProfiles = {
    list: vi.fn(async () => [{ ...PROFILE, id: "profile-editor" }]),
    usage: vi.fn(async () => ({ agents: [], channels: [], schedules: [] })),
    create: vi.fn(async () => PROFILE),
    update: vi.fn(async () => ({ profile: PROFILE, rejected: [] })),
    delete: vi.fn(async () => undefined),
  };
  const ownerCtx = { profiles: ownerProfiles } as unknown as ApiContext;
  const ctx = {
    profiles: ownProfiles,
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
    madeFor,
    ownerProfiles,
    ownProfiles,
  };
}

describe("an Agent Editor and the profile set", () => {
  /** TEST_SCENARIO: The picker asks for one agent's profiles. The editor gets
   * the owner's set, in a context bound to that agent and naming the editor,
   * and their own set is never read. */
  it("lists the owner's profiles for the agent the editor edits", async () => {
    const w = world(BOB);
    const listed = await w.caller.profiles.list({ agentId: AGENT });
    expect(listed.map((profile) => profile.id)).toEqual(["profile-owner"]);
    expect(w.ownerProfiles.list).toHaveBeenCalledWith({ agentId: AGENT });
    expect(w.ownProfiles.list).not.toHaveBeenCalled();
    expect(w.madeFor).toEqual([
      expect.objectContaining({
        sub: OWNER,
        agentIds: [AGENT],
        actingEditor: "bob",
      }),
    ]);
  });

  /** TEST_SCENARIO: An editor without the settings permission is refused, and
   * no profile set is asked at all. */
  it("refuses an editor who may not change settings", async () => {
    editorPermissions = ["view"];
    const w = world(BOB);
    await expect(
      w.caller.profiles.create({
        name: "Fast review",
        harness: "claude-code",
        providerTemplate: "anthropic",
        model: "anthropic/claude-sonnet-5-5",
        agentId: AGENT,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(w.ownerProfiles.create).not.toHaveBeenCalled();
    expect(w.ownProfiles.create).not.toHaveBeenCalled();
    editorPermissions = EDITS;
  });

  /** TEST_SCENARIO: With no agent named, nothing is re-bound: an editor's own
   * profile list is theirs, as Settings shows it. */
  it("keeps the editor's own set for a list that names no agent", async () => {
    const w = world(BOB);
    const listed = await w.caller.profiles.list();
    expect(listed.map((profile) => profile.id)).toEqual(["profile-editor"]);
    expect(w.madeFor).toEqual([]);
  });

  /** TEST_SCENARIO: Through a shared agent an editor may read the owner's
   * profiles and reference them, and nothing else: saving, renaming and
   * deleting are refused, and no set is asked. */
  it.each([
    {
      procedure: "create",
      call: (c: ReturnType<typeof world>["caller"]) =>
        c.profiles.create({
          name: "Fast review",
          harness: "claude-code",
          providerTemplate: "anthropic",
          model: "anthropic/claude-sonnet-5-5",
          agentId: AGENT,
        }),
    },
    {
      procedure: "update",
      call: (c: ReturnType<typeof world>["caller"]) =>
        c.profiles.update({ id: "profile-owner", agentId: AGENT, name: "x" }),
    },
    {
      procedure: "delete",
      call: (c: ReturnType<typeof world>["caller"]) =>
        c.profiles.delete({ id: "profile-owner", agentId: AGENT }),
    },
  ])(
    "refuses an editor's $procedure through the shared agent",
    async ({ call }) => {
      const w = world(BOB);
      await expect(call(w.caller)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("Only the agent's owner"),
      });
      expect(w.ownerProfiles.create).not.toHaveBeenCalled();
      expect(w.ownerProfiles.update).not.toHaveBeenCalled();
      expect(w.ownerProfiles.delete).not.toHaveBeenCalled();
      expect(w.ownProfiles.create).not.toHaveBeenCalled();
      expect(w.ownProfiles.update).not.toHaveBeenCalled();
      expect(w.ownProfiles.delete).not.toHaveBeenCalled();
    },
  );

  /** TEST_SCENARIO: The owner saving from a chat passes the agent too, and the
   * write is theirs: no re-binding, no refusal. */
  it("lets the owner save from a chat of their own agent", async () => {
    const w = world(person(OWNER, "alice@example.com"));
    await w.caller.profiles.create({
      name: "Fast review",
      harness: "claude-code",
      providerTemplate: "anthropic",
      model: "anthropic/claude-sonnet-5-5",
      agentId: AGENT,
    });
    expect(w.ownProfiles.create).toHaveBeenCalled();
    expect(w.madeFor).toEqual([]);
  });

  /** TEST_SCENARIO: An owner's API key bound to another agent may not read
   * this agent's profiles or a profile's usage through it, and no set is
   * asked. */
  it.each(["list", "usage"] as const)(
    "refuses the %s to a key bound to another agent",
    async (procedure) => {
      const w = world({
        ...person(OWNER, "alice@example.com"),
        agentIds: ["other-bot"],
      });
      await expect(
        procedure === "list"
          ? w.caller.profiles.list({ agentId: AGENT })
          : w.caller.profiles.usage({ id: "profile-owner", agentId: AGENT }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(w.ownProfiles.list).not.toHaveBeenCalled();
      expect(w.ownProfiles.usage).not.toHaveBeenCalled();
    },
  );
});
