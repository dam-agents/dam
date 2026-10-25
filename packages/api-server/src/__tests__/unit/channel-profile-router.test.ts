// TEST_OVERVIEW: Setting the profile a channel runs on. The write is the agent's: an Agent Editor holding `settings` acts for the agent's owner, so a shared agent's channel is written as the owner's and the editor's own set is never the one that decides. A binding that no longer exists, or a profile the owner does not hold, is a refusal the caller sees rather than a silent success.
import { describe, expect, it, vi } from "vitest";
import type {
  AgentPermission,
  ApiContext,
  SetChannelProfileResult,
  UserIdentity,
} from "api-server-api";
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

const INPUT = {
  agentId: AGENT,
  type: "slack" as const,
  slackChannelId: "C1",
  profileId: "profile-owner",
};

function world(
  user: UserIdentity,
  answer: SetChannelProfileResult | (() => SetChannelProfileResult) = "saved",
) {
  const madeFor: UserIdentity[] = [];
  const writes: { owner: string; input: typeof INPUT }[] = [];
  const channelsFor = (identity: UserIdentity) => ({
    available: {},
    telegramBotUsername: () => null,
    setProfile: vi.fn(async (input: typeof INPUT) => {
      const verdict = typeof answer === "function" ? answer() : answer;
      if (verdict === "saved") writes.push({ owner: identity.sub, input });
      return verdict;
    }),
  });
  const ctx = {
    user,
    channels: channelsFor(user),
    actOnAgent: createActOnAgent({
      user,
      self: () => ctx,
      agentOfTarget: resolveTarget,
      editorStanding: standing,
      contextFor: (identity) => {
        madeFor.push(identity);
        return {
          ...ctx,
          user: identity,
          channels: channelsFor(identity),
        } as unknown as ApiContext;
      },
    }),
  } as unknown as ApiContext;
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), madeFor, writes };
}

describe("setting a channel's profile", () => {
  /** TEST_SCENARIO: the owner's own call writes the channel of the agent it
   * names. */
  it("writes the agent's channel for the owner", async () => {
    const w = world(person(OWNER, "alice@example.com"));
    await expect(w.caller.channels.setProfile(INPUT)).resolves.toBe(true);
    expect(w.writes).toEqual([{ owner: OWNER, input: INPUT }]);
  });

  /** TEST_SCENARIO: an editor holding `settings` acts for the agent's owner, so
   * the write is the owner's — a binding last written by someone else matches
   * all the same. */
  it("writes as the agent's owner when an editor picks one", async () => {
    const w = world(BOB);
    await expect(w.caller.channels.setProfile(INPUT)).resolves.toBe(true);
    expect(w.writes).toEqual([{ owner: OWNER, input: INPUT }]);
    expect(w.madeFor).toEqual([
      expect.objectContaining({ sub: OWNER, actingEditor: "bob" }),
    ]);
  });

  /** TEST_SCENARIO: an editor without the settings permission changes nothing. */
  it("refuses an editor who may not change settings", async () => {
    editorPermissions = ["view"];
    const w = world(BOB);
    await expect(w.caller.channels.setProfile(INPUT)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(w.writes).toEqual([]);
    editorPermissions = EDITS;
  });

  /** TEST_SCENARIO: a binding that no longer exists is a refusal, not a success
   * the UI would show as done. */
  it("refuses when the agent has no such channel", async () => {
    const w = world(person(OWNER, "alice@example.com"), "no-such-channel");
    await expect(w.caller.channels.setProfile(INPUT)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  /** TEST_SCENARIO: another owner's profile is refused rather than stored as a
   * reference that resolves to nothing. */
  it("refuses a profile the agent's owner does not hold", async () => {
    const w = world(person(OWNER, "alice@example.com"), "not-owned");
    await expect(w.caller.channels.setProfile(INPUT)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
