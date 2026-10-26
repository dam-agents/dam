// TEST_OVERVIEW: Profiles are an owner's named presets. A profile names a provider template, so whether it runs on an agent follows from the agent's grants: its own Connection of the template, else an owner's one it may be granted, never one replacing a rival of the same alias. An owner with no profile is seeded one Default where the install names it, and every owner has one default for new agents, which a new agent starts on and which cannot be deleted; a profile in use cannot be deleted; an edit no referencing agent can run is put back.
import { TRPCError } from "@trpc/server";
import type {
  AliasedConnection,
  HarnessCatalog,
  OwnerModelCatalogView,
} from "api-server-api";
import { createDb, type Db } from "db";
import { describe, expect, it } from "vitest";
import {
  createProfilesRepository,
  type ProfileReferences,
  type ProfileRow,
  type ProfilesRepository,
} from "../../modules/profiles/infrastructure/profiles-repository.js";
import {
  bindDefaultProfile,
  createProfilesService,
  newAgentDefault,
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
  const state: { defaultId?: string } = {};
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
    defaultOf: async () => rows.find((r) => r.id === state.defaultId) ?? null,
    setDefault: async (
      _owner: string,
      id: string,
      { onlyIfNone = false } = {},
    ) => {
      if (!onlyIfNone || state.defaultId === undefined) state.defaultId = id;
    },
    insert: async () => rows[0]!,
    update: async (
      _owner: string,
      id: string,
      patch: Partial<ProfileRow>,
      options: { expect?: Date; at?: Date } = {},
    ) => {
      const i = rows.findIndex((r) => r.id === id);
      if (options.expect && rows[i]!.updatedAt !== options.expect) return null;
      writes.updates.push(patch);
      rows[i] = {
        ...rows[i]!,
        ...patch,
        updatedAt: options.at ?? new Date(rows[i]!.updatedAt.getTime() + 1),
      };
      return rows[i];
    },
    deleteIfUnused: async () => opts.references ?? ("deleted" as const),
    seed: async (_owner: string, seed: Partial<ProfileRow>) => {
      writes.seeds += 1;
      rows.push(profile({ ...seed, id: "profile-seeded" }));
    },
    bindChatProfile: async (_owner: string, agentId: string) => {
      writes.binds.push(agentId);
      return true;
    },
    ownerConnections: async () => opts.owned ?? [SHARED],
    agentConnections: async () => opts.granted ?? [SHARED],
  } as unknown as ProfilesRepository;
  return { repo, writes, rows, state };
}

function service(
  repo: ProfilesRepository,
  opts: {
    seed?: { harness: string; model: string } | null;
    ownerCatalog?: () => Promise<OwnerModelCatalogView>;
    republish?: () => Promise<string | null>;
    agentBinding?: readonly string[] | "*";
  } = {},
) {
  return createProfilesService({
    repo,
    owner: "owner-1",
    catalog,
    seed:
      opts.seed === undefined
        ? { harness: "pi", model: "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017" }
        : opts.seed,
    ...(opts.ownerCatalog && { ownerCatalog: opts.ownerCatalog }),
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
  /** TEST_SCENARIO: an owner with no profile is given "Default" on the seed the install names, marked as the default for new agents; an install that names none seeds nothing, so a later configuration still seeds (QA D7). */
  it("seeds Default for an owner with no profile, where the install names one", async () => {
    const served = fakeRepo({ rows: [] });
    const listed = await service(served.repo).list();
    expect(served.writes.seeds).toBe(1);
    expect(listed).toEqual([
      expect.objectContaining({
        name: "Default",
        harness: "pi",
        model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
        newAgentDefault: true,
      }),
    ]);
    const unserved = fakeRepo({ rows: [] });
    await service(unserved.repo, { seed: null }).list();
    expect(unserved.writes.seeds).toBe(0);
  });

  /** TEST_SCENARIO: on an install without the shared CurveBender, an owner's first provider that has listed its models gives "Default": the install's default harness where it runs, and the model the platform prefers for work over the newest it lists; with no provider listed yet, nothing is seeded and the next read tries again. */
  it("seeds Default from the first listed provider without the shared CurveBender", async () => {
    const model = (upstreamId: string, harnesses: string[]) => ({
      name: `ibm/${upstreamId}`,
      upstreamId,
      contextWindow: null,
      maxOutputTokens: null,
      reasoning: null,
      vision: null,
      prices: null,
      source: { limits: "none" as const, prices: "none" as const },
      harnesses,
    });
    const listing = (status: "listed" | "unavailable") => async () =>
      ({
        defaultHarness: "claude-code",
        modelRouter: true,
        harnesses: [],
        providers: [
          {
            connectionId: "conn-ibm",
            alias: "ibm",
            template: "ibm-litellm",
            displayName: "IBM",
            status,
            listedAt: null,
            harnesses: ["claude-code", "pi"],
            models: [
              model("aws/claude-sonnet-6", ["claude-code", "pi"]),
              model("aws/claude-opus-5-5", ["claude-code", "pi"]),
            ],
          },
        ],
      }) as OwnerModelCatalogView;
    const waiting = fakeRepo({ rows: [] });
    await service(waiting.repo, {
      seed: null,
      ownerCatalog: listing("unavailable"),
    }).list();
    expect(waiting.writes.seeds).toBe(0);
    const listed = fakeRepo({ rows: [] });
    const profiles = await service(listed.repo, {
      seed: null,
      ownerCatalog: listing("listed"),
    }).list();
    expect(profiles).toEqual([
      expect.objectContaining({
        name: "Default",
        harness: "claude-code",
        providerTemplate: "ibm-litellm",
        model: "ibm/aws/claude-opus-5-5",
        newAgentDefault: true,
      }),
    ]);
  });

  /** TEST_SCENARIO: an owner who already has profiles gets no "Default"; their oldest becomes the default for new agents. */
  it("marks the oldest profile of an owner who has some", async () => {
    const { repo, writes } = fakeRepo({
      rows: [
        profile({ id: "old", name: "Old" }),
        profile({ id: "new", name: "New" }),
      ],
    });
    const listed = await service(repo).list();
    expect(writes.seeds).toBe(0);
    expect(listed.map((p) => [p.id, p.newAgentDefault])).toEqual([
      ["old", true],
      ["new", false],
    ]);
  });

  /** TEST_SCENARIO: the default for new agents cannot be deleted, and the refusal says how to move it; once another profile is the default, it can. */
  it("refuses to delete the default until another one is set", async () => {
    const { repo } = fakeRepo({
      rows: [
        profile({ id: "old", name: "Old" }),
        profile({ id: "new", name: "New" }),
      ],
    });
    const svc = service(repo);
    await svc.list();
    const err = await refusal(svc.delete("old"));
    expect(err.message).toContain("Make another profile the default first");
    await svc.setDefault("new");
    await expect(svc.delete("old")).resolves.toBeUndefined();
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

  /** TEST_SCENARIO: a second edit lands while the first is sent to the agents; every agent rejects the first, and its revert leaves the second edit in place rather than undo an edit that was already answered. */
  it("keeps an edit that landed while a rejected one was sent", async () => {
    const { repo, rows } = fakeRepo({
      references: {
        ...none,
        agents: [{ id: "a1", chat: "profile-1", platform: null }],
      },
    });
    await refusal(
      service(repo, {
        republish: async () => {
          await repo.update("owner-1", "profile-1", { name: "Later edit" });
          return "effort=ultra is not offered";
        },
      }).update({ id: "profile-1", settings: { effort: "ultra" } }),
    );
    expect(rows[0]).toMatchObject({
      name: "Later edit",
      settings: { effort: "ultra" },
    });
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Db that renders each statement and answers it
 * as Postgres would for an empty `agents` table: a grant read lists `granted`,
 * an UPDATE of `agents` finds no row, and an INSERT into it adds the row.
 */
function agentsTableDb(granted: readonly AliasedConnection[]) {
  const render = createDb("postgresql://unused:unused@127.0.0.1:1/unused");
  void render.sql.end({ timeout: 0 });
  const agentRows = new Map<string, unknown>();
  const answer = (query: { sql: string; params: unknown[] }): unknown[] => {
    if (query.sql.startsWith("select")) return [...granted];
    if (query.sql.startsWith('update "agents"')) return [];
    if (query.sql.startsWith('insert into "agents"')) {
      const [id, , profileId] = query.params;
      agentRows.set(String(id), profileId);
      return [{ id }];
    }
    throw new Error(`unexpected statement: ${query.sql}`);
  };
  const wrap = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null) return value;
    return new Proxy(value, {
      get(target, key) {
        const builder = target as {
          toSQL?: () => { sql: string; params: unknown[] };
        };
        if (key === "then" && builder.toSQL)
          return (resolve: (rows: unknown[]) => void) =>
            resolve(answer(builder.toSQL!()));
        const member = Reflect.get(target, key) as unknown;
        return typeof member === "function"
          ? (...args: unknown[]) =>
              wrap((member as (...a: unknown[]) => unknown).apply(target, args))
          : member;
      },
    });
  };
  return { db: wrap(render.db) as Db, agentRows };
}

describe("a new agent's default", () => {
  const owner = (repo: ProfilesRepository) => ({
    repo,
    owner: "owner-1",
    catalog,
    seed: null,
  });

  /** TEST_SCENARIO: a new agent is granted the owner's Connection of the default profile's template, and once it holds it, its chat default is that profile. */
  it("starts a new agent on the default profile", async () => {
    const { repo, writes } = fakeRepo();
    const chosen = await newAgentDefault(owner(repo));
    expect(chosen).toMatchObject({
      profile: { id: "profile-1", harness: "claude-code" },
      connectionId: SHARED.id,
    });
    await bindDefaultProfile(owner(repo), "agent-1", chosen!.profile);
    expect(writes.binds).toEqual(["agent-1"]);
  });

  /** TEST_SCENARIO: a create that named another provider keeps it, and the agent's first hello converts its default as before; the binder says why. */
  it("binds nothing to an agent without the profile's provider", async () => {
    const { repo, writes } = fakeRepo({ granted: [OWN_KEY] });
    expect(await bindDefaultProfile(owner(repo), "agent-1", profile())).toMatch(
      /holds no curve-bender-deployment Connection/,
    );
    expect(writes.binds).toEqual([]);
  });

  /** TEST_SCENARIO: the agent's row is written by the agent-created saga, which can run after the create returns, so the bind through the real repository still leaves the new agent's chat default on the profile when that row does not exist yet (QA R1: an UPDATE of the missing row bound nothing). */
  it("binds a new agent whose row the saga has not written yet", async () => {
    const { db, agentRows } = agentsTableDb([SHARED]);
    const repo = createProfilesRepository(db, {
      hashSub: (raw: string) => raw,
    } as never);
    expect(
      await bindDefaultProfile(owner(repo), "agent-new", profile()),
    ).toBeNull();
    expect(agentRows.get("agent-new")).toBe("profile-1");
  });

  /** TEST_SCENARIO: an owner who holds no Connection of the default profile's template has nothing to grant, so the harness's provider order decides. */
  it("offers nothing without a Connection of the template", async () => {
    const { repo } = fakeRepo({ owned: [OWN_KEY] });
    expect(await newAgentDefault(owner(repo))).toBeNull();
  });
});
