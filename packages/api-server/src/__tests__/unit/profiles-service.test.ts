// TEST_OVERVIEW: Profiles are an owner's named presets. A profile names a provider template, so whether it runs on an agent follows from the agent's grants: its own Connection of the template, else an owner's one it may be granted, never one replacing a rival of the same alias. The owner is seeded one Default where the deployment serves the shared provider; a profile in use cannot be deleted; an edit no referencing agent can run is put back.
import { TRPCError } from "@trpc/server";
import type { AliasedConnection, HarnessCatalog } from "api-server-api";
import { describe, expect, it } from "vitest";
import type {
  ProfileReferences,
  ProfileRow,
  ProfilesRepository,
} from "../../modules/profiles/infrastructure/profiles-repository.js";
import {
  bindDefaultProfile,
  createProfilesService,
  profileResolver,
} from "../../modules/profiles/services/profiles-service.js";

const catalog: Pick<HarnessCatalog, "default" | "harnesses"> = {
  default: "claude-code",
  harnesses: [
    {
      name: "claude-code",
      displayName: "Claude",
      providers: ["curve-bender", "anthropic"],
      tags: [],
      experimental: false,
    },
  ],
};

const SHARED: AliasedConnection = {
  id: "conn-shared",
  name: "CurveBender (shared)",
  templateId: "curve-bender-deployment",
};
const OWN_KEY: AliasedConnection = {
  id: "conn-own",
  name: "CurveBender (own key)",
  templateId: "curve-bender",
};

const profile = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  id: "profile-1",
  owner: "owner-1",
  name: "Default",
  seed: "seeded-default",
  harness: "claude-code",
  providerTemplate: "curve-bender-deployment",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  settings: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const none: ProfileReferences = { agents: [], channels: [], schedules: [] };

function fakeRepo(
  opts: {
    rows?: ProfileRow[];
    owned?: AliasedConnection[];
    granted?: AliasedConnection[];
    references?: ProfileReferences;
  } = {},
) {
  const rows = opts.rows ?? [profile()];
  const writes = {
    scopes: [] as (readonly string[] | undefined)[],
    seeds: 0,
    updates: [] as Partial<ProfileRow>[],
    binds: [] as string[],
  };
  const repo = {
    references: async (_owner: string, agentIds?: readonly string[]) => {
      writes.scopes.push(agentIds);
      return opts.references ?? none;
    },
    list: async () => rows,
    get: async (id: string, owner?: string) =>
      rows.find(
        (r) => r.id === id && (owner === undefined || r.owner === owner),
      ) ?? null,
    seeded: async () => rows.find((r) => r.seed !== null) ?? null,
    insert: async () => rows[0]!,
    update: async (_owner: string, _id: string, patch: Partial<ProfileRow>) => {
      writes.updates.push(patch);
    },
    deleteIfUnused: async () => opts.references ?? ("deleted" as const),
    seed: async () => {
      writes.seeds += 1;
    },
    bindChatProfile: async (_owner: string, agentId: string) => {
      writes.binds.push(agentId);
    },
    ownerConnections: async () => opts.owned ?? [SHARED],
    agentConnections: async () => opts.granted ?? [SHARED],
  } as unknown as ProfilesRepository;
  return { repo, writes };
}

function service(
  repo: ProfilesRepository,
  opts: {
    sharedProvider?: boolean;
    republish?: () => Promise<string | null>;
    agentBinding?: readonly string[] | "*";
  } = {},
) {
  return createProfilesService({
    repo,
    owner: "owner-1",
    catalog,
    sharedProvider: opts.sharedProvider ?? true,
    agentBinding: opts.agentBinding ?? "*",
    resolve: profileResolver(repo),
    republish: opts.republish ?? (async () => null),
  });
}

async function refusal(run: Promise<unknown>): Promise<TRPCError> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TRPCError);
  return err as TRPCError;
}

const resolve = (repo: ProfilesRepository, owner?: string) =>
  profileResolver(repo)({
    profileId: "profile-1",
    agentId: "agent-1",
    ...(owner !== undefined && { owner }),
  });

describe("what a profile runs on, for one agent", () => {
  /** TEST_SCENARIO: the owner holds two Connections of the template; the one granted to the agent is the one that runs. */
  it("runs on the agent's own grant of the template", async () => {
    const second = { ...SHARED, id: "conn-shared-2" };
    const { repo } = fakeRepo({ owned: [SHARED, second], granted: [second] });
    const resolved = await resolve(repo);
    expect(resolved?.unavailable).toBeNull();
    expect(resolved?.pair.provider).toBe("conn-shared-2");
  });

  /** TEST_SCENARIO: the owner holds the provider and the agent does not; the profile does not run yet, but a pick may grant it (QA D3). */
  it("offers to grant an owned provider the agent does not hold", async () => {
    const { repo } = fakeRepo({ granted: [] });
    const resolved = await resolve(repo);
    expect(resolved?.unavailable).toMatch(/isn't attached/);
    expect(resolved?.attachable).toBe(true);
  });

  /** TEST_SCENARIO: the agent holds the own-key CurveBender, a rival of the shared one's alias; granting the shared one would silently swap the provider, so the profile cannot run and is not attachable. */
  it("never replaces a rival provider of the same alias", async () => {
    const { repo } = fakeRepo({ owned: [SHARED, OWN_KEY], granted: [OWN_KEY] });
    const resolved = await resolve(repo);
    expect(resolved?.unavailable).toMatch(/CurveBender \(own key\)/);
    expect(resolved?.attachable).toBe(false);
  });

  /** TEST_SCENARIO: the owner holds no Connection of the template. */
  it("cannot run on a provider nobody connected", async () => {
    const { repo } = fakeRepo({ owned: [], granted: [] });
    expect((await resolve(repo))?.unavailable).toMatch(/not connected/);
  });

  /** TEST_SCENARIO: a write names the caller, so another owner's profile can never be attached to an agent. */
  it("finds no profile of another owner for a write", async () => {
    const { repo } = fakeRepo();
    expect(await resolve(repo, "owner-2")).toBeNull();
  });
});

describe("the owner's profiles", () => {
  /** TEST_SCENARIO: an install that serves no shared CurveBender seeds nothing, so a later configuration still seeds Default (QA D7). */
  it("seeds Default only where the shared provider is served", async () => {
    const served = fakeRepo();
    await service(served.repo).list();
    expect(served.writes.seeds).toBe(1);
    const unserved = fakeRepo();
    await service(unserved.repo, { sharedProvider: false }).list();
    expect(unserved.writes.seeds).toBe(0);
  });

  /** TEST_SCENARIO: a key bound to some agents reads usage of those agents only — no other agent's id, channel or schedule leaks into the list or the usage answer. */
  it("narrows usage to the agents a bound key may see", async () => {
    const { repo, writes } = fakeRepo();
    const bound = service(repo, { agentBinding: ["agent-a"] });
    await bound.list();
    await bound.usage("profile-1");
    expect(writes.scopes).toEqual([["agent-a"], ["agent-a"]]);
  });

  /** TEST_SCENARIO: a model of another provider than the profile's template would run on a provider nobody chose. */
  it("refuses a model that is not the provider's", async () => {
    const { repo } = fakeRepo();
    const err = await refusal(
      service(repo).create({
        name: "Fast review",
        harness: "claude-code",
        providerTemplate: "curve-bender-deployment",
        model: "anthropic/claude-sonnet-5-5",
      }),
    );
    expect(err.code).toBe("BAD_REQUEST");
  });

  /** TEST_SCENARIO: a profile something points at cannot be deleted, and the refusal says what uses it. */
  it("refuses to delete a profile in use", async () => {
    const { repo } = fakeRepo({
      references: {
        ...none,
        schedules: [
          { profileId: "profile-1", id: "s1", name: "Nightly", agentId: "a" },
        ],
      },
    });
    const err = await refusal(service(repo).delete("profile-1"));
    expect(err.message).toContain("1 schedule");
  });

  /** TEST_SCENARIO: an edit every referencing agent rejects is put back, so new chats on them do not fail on it (QA D5). */
  it("puts back an edit no referencing agent can run", async () => {
    const { repo, writes } = fakeRepo({
      references: {
        ...none,
        agents: [{ id: "a1", chat: "profile-1", platform: null }],
      },
    });
    const err = await refusal(
      service(repo, {
        republish: async () => "effort=ultra is not offered",
      }).update({
        id: "profile-1",
        settings: { effort: "ultra" },
      }),
    );
    expect(err.message).toContain("effort=ultra");
    expect(writes.updates.at(-1)).toMatchObject({ settings: {} });
  });

  /** TEST_SCENARIO: a rename changes nothing an agent runs, so it is sent to nobody. */
  it("sends a rename to no agent", async () => {
    const { repo } = fakeRepo({
      references: {
        ...none,
        agents: [{ id: "a1", chat: "profile-1", platform: null }],
      },
    });
    let republished = 0;
    await service(repo, {
      republish: async () => {
        republished += 1;
        return null;
      },
    }).update({ id: "profile-1", name: "Renamed" });
    expect(republished).toBe(0);
  });
});

describe("a new agent's default", () => {
  const owner = (repo: ProfilesRepository) => ({
    repo,
    owner: "owner-1",
    catalog,
    sharedProvider: true,
  });

  /** TEST_SCENARIO: a new agent on the seeded profile's harness, granted its provider, starts on Default. */
  it("binds the seeded profile when the harness and the grant fit", async () => {
    const { repo, writes } = fakeRepo();
    await bindDefaultProfile(owner(repo), "agent-1", "claude-code");
    expect(writes.binds).toEqual(["agent-1"]);
  });

  /** TEST_SCENARIO: another harness keeps today's first-hello conversion. */
  it("binds nothing to another harness", async () => {
    const { repo, writes } = fakeRepo();
    await bindDefaultProfile(owner(repo), "agent-1", "codex");
    expect(writes.binds).toEqual([]);
  });
});
