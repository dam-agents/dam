import { describe, expect, it } from "vitest";
import type { AliasedConnection } from "api-server-api";
import type {
  DeleteOutcome,
  ProfileRow,
  ProfileWrite,
  ProfilesRepository,
} from "../../modules/profiles/infrastructure/profiles-repository.js";
import { createProfileResolver } from "../../modules/profiles/services/profile-resolution.js";

function row(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "profile-1",
    owner: "owner-1",
    name: "Default",
    seed: "seeded-default",
    harness: "claude-code",
    providerTemplate: "curve-bender-deployment",
    model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    settings: {},
    createdAt: new Date("2026-10-25T00:00:00Z"),
    updatedAt: new Date("2026-10-25T00:00:00Z"),
    ...overrides,
  };
}

const sharedOwned: AliasedConnection = {
  id: "conn-shared",
  name: "CurveBender (shared)",
  templateId: "curve-bender-deployment",
};
const ownKey: AliasedConnection = {
  id: "conn-own",
  name: "CurveBender (own key)",
  templateId: "curve-bender",
};

function repo(opts: {
  profile?: ProfileRow | null;
  owned?: AliasedConnection[];
  granted?: AliasedConnection[];
}): ProfilesRepository {
  return {
    list: async () => [],
    get: async () => (opts.profile === undefined ? row() : opts.profile),
    insert: async () => row(),
    update: async () => null,
    deleteIfUnused: async (): Promise<DeleteOutcome> => ({
      outcome: "missing",
    }),
    usage: async () => ({ agents: [], channels: [], schedules: [] }),
    usageCounts: async () => new Map(),
    seed: async (_owner: string, _profile: ProfileWrite | null) => undefined,
    ownerConnections: async () => opts.owned ?? [],
    agentConnections: async () => opts.granted ?? [],
  };
}

describe("profile resolution", () => {
  it("returns null for a profile this owner does not have", async () => {
    const resolver = createProfileResolver({ repo: repo({ profile: null }) });
    expect(
      await resolver.resolve({ profileId: "profile-x", owner: "owner-1" }),
    ).toBeNull();
  });

  it("resolves the profile's pair on the agent's own grant", async () => {
    const resolver = createProfileResolver({
      repo: repo({ owned: [sharedOwned], granted: [sharedOwned] }),
    });
    const resolved = await resolver.resolve({
      profileId: "profile-1",
      owner: "owner-1",
      agentId: "agent-1",
    });
    expect(resolved).toMatchObject({
      pair: {
        harness: "claude-code",
        provider: "conn-shared",
        model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
      },
      unavailable: null,
      grantableProvider: null,
    });
  });

  it("marks an owned but ungranted provider attachable when no rival alias is held", async () => {
    const resolver = createProfileResolver({
      repo: repo({ owned: [sharedOwned], granted: [] }),
    });
    const resolved = await resolver.resolve({
      profileId: "profile-1",
      owner: "owner-1",
      agentId: "agent-1",
    });
    expect(resolved?.grantableProvider).toBe("conn-shared");
    expect(resolved?.unavailable).toBeNull();
  });

  it("refuses to attach over a granted rival of the same alias", async () => {
    const resolver = createProfileResolver({
      repo: repo({ owned: [sharedOwned], granted: [ownKey] }),
    });
    const resolved = await resolver.resolve({
      profileId: "profile-1",
      owner: "owner-1",
      agentId: "agent-1",
    });
    expect(resolved?.unavailable).toEqual({
      reason: "rival-provider",
      detail:
        "this agent runs on CurveBender (own key); detach it to use CurveBender (shared)",
    });
    expect(resolved?.pair.provider).toBeNull();
    expect(resolved?.grantableProvider).toBeNull();
  });

  it("takes the agent's own grant when the owner holds two Connections of the template", async () => {
    const second: AliasedConnection = {
      id: "conn-shared-2",
      name: "CurveBender (shared) 2",
      templateId: "curve-bender-deployment",
    };
    const resolver = createProfileResolver({
      repo: repo({ owned: [sharedOwned, second], granted: [second] }),
    });
    const resolved = await resolver.resolve({
      profileId: "profile-1",
      owner: "owner-1",
      agentId: "agent-1",
    });
    expect(resolved?.pair.provider).toBe("conn-shared-2");
    expect(resolved?.unavailable).toBeNull();
    expect(resolved?.grantableProvider).toBeNull();
  });

  it("falls back to the owner's oldest Connection when the agent holds none", async () => {
    const second: AliasedConnection = {
      id: "conn-shared-2",
      name: "CurveBender (shared) 2",
      templateId: "curve-bender-deployment",
    };
    const resolver = createProfileResolver({
      repo: repo({ owned: [sharedOwned, second], granted: [] }),
    });
    const resolved = await resolver.resolve({
      profileId: "profile-1",
      owner: "owner-1",
      agentId: "agent-1",
    });
    expect(resolved?.pair.provider).toBe("conn-shared");
    expect(resolved?.grantableProvider).toBe("conn-shared");
  });

  it("reports a provider the owner does not hold", async () => {
    const resolver = createProfileResolver({
      repo: repo({ owned: [], granted: [] }),
    });
    const resolved = await resolver.resolve({
      profileId: "profile-1",
      owner: "owner-1",
      agentId: "agent-1",
    });
    expect(resolved?.unavailable).toEqual({
      reason: "no-provider",
      detail: "CurveBender (shared) is not connected",
    });
  });

  it("reports a harness the agent's image does not carry", async () => {
    const resolver = createProfileResolver({
      repo: repo({ owned: [sharedOwned], granted: [sharedOwned] }),
      carriedHarnesses: async () => ["codex"],
    });
    const resolved = await resolver.resolve({
      profileId: "profile-1",
      owner: "owner-1",
      agentId: "agent-1",
    });
    expect(resolved?.unavailable?.reason).toBe("harness-not-carried");
  });

  it("reports a model the harness no longer lists", async () => {
    const resolver = createProfileResolver({
      repo: repo({ owned: [sharedOwned], granted: [sharedOwned] }),
      carriedHarnesses: async () => ["claude-code"],
      listedModels: async () => ["cb/xtts/deepseek-v3.2"],
    });
    const resolved = await resolver.resolve({
      profileId: "profile-1",
      owner: "owner-1",
      agentId: "agent-1",
    });
    expect(resolved?.unavailable?.reason).toBe("model-not-listed");
  });

  it("checks nothing about the runtime without an agent", async () => {
    let asked = 0;
    const resolver = createProfileResolver({
      repo: repo({ owned: [sharedOwned] }),
      carriedHarnesses: async () => {
        asked += 1;
        return [];
      },
    });
    const resolved = await resolver.resolve({
      profileId: "profile-1",
      owner: "owner-1",
    });
    expect(resolved?.unavailable).toBeNull();
    expect(asked).toBe(0);
  });

  it("carries the profile's settings into the resolved pair", async () => {
    const resolver = createProfileResolver({
      repo: repo({
        profile: row({ settings: { effort: "high", subagentModel: "cb/x" } }),
        owned: [sharedOwned],
        granted: [sharedOwned],
      }),
    });
    const resolved = await resolver.resolve({
      profileId: "profile-1",
      owner: "owner-1",
      agentId: "agent-1",
    });
    expect(resolved?.pair.settings).toEqual({
      effort: "high",
      subagentModel: "cb/x",
    });
  });
});
