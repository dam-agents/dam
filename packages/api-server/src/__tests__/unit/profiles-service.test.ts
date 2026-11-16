// TEST_OVERVIEW: Profiles are an owner's named presets. A profile names a provider template, so whether it runs on an agent follows from the agent's grants: its own Connection of the template, else an owner's one it may be granted, never one replacing a rival of the same alias. No profile is made for an owner, and no profile is a default: the owner's default for new agents is a profile or values of their own, which a new agent's chat default is initialised from, else the base default (Pi on the shared CurveBender's work model, saved as values); any profile not in use can be deleted; an edit no referencing agent can run is put back.
import { TRPCError } from "@trpc/server";
import {
  CURVE_BENDER_WORK_MODEL,
  type AliasedConnection,
  type HarnessCatalog,
  type SessionPair,
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
  bindNewAgentDefault,
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
const ANTHROPIC: AliasedConnection = {
  id: "conn-anthropic",
  name: "Anthropic",
  templateId: "anthropic",
};
const HAIKU = "anthropic/claude-haiku-5";

const profile = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  id: "profile-1",
  owner: "owner-1",
  name: "Default",
  harness: "claude-code",
  providerTemplate: "curve-bender-deployment",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  subagentProviderTemplate: null,
  subagentModel: null,
  settings: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const none: ProfileReferences = {
  agents: [],
  channels: [],
  schedules: [],
  artifacts: [],
};

function fakeRepo(
  opts: {
    rows?: ProfileRow[];
    owned?: AliasedConnection[];
    granted?: AliasedConnection[];
    references?: ProfileReferences;
  } = {},
) {
  const rows = opts.rows ?? [profile()];
  const state: {
    chosen?: { profileId: string } | { sessionPair: SessionPair };
  } = {};
  const writes = {
    scopes: [] as (readonly string[] | undefined)[],
    updates: [] as Partial<ProfileRow>[],
    binds: [] as [string, unknown][],
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
    newAgentDefaultOf: async () => {
      const chosen = state.chosen;
      if (!chosen) return null;
      if ("sessionPair" in chosen)
        return { profile: null, pair: chosen.sessionPair };
      const row = rows.find((r) => r.id === chosen.profileId);
      return row ? { profile: row, pair: null } : null;
    },
    setNewAgentDefault: async (
      _owner: string,
      chosen: { profileId: string } | { sessionPair: SessionPair },
    ) => {
      state.chosen = chosen;
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
    bindChatDefault: async (_owner: string, agentId: string, chat: unknown) => {
      writes.binds.push([agentId, chat]);
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
    republish?: () => Promise<string | null>;
    settingsProblem?: () => Promise<string | null>;
    agentBinding?: readonly string[] | "*";
  } = {},
) {
  return createProfilesService({
    repo,
    owner: "owner-1",
    catalog,
    sharedCurveBender: true,
    agentBinding: opts.agentBinding ?? "*",
    resolve: profileResolver(repo),
    republish: opts.republish ?? (async () => null),
    settingsProblem: opts.settingsProblem ?? (async () => null),
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

  /** TEST_SCENARIO: a profile names a platform sub-agent too (D193B), kept beside the primary's pair, on the profile's own harness, so a slot following the profile spawns it without a pick of its own. */
  it("lends the platform sub-agent it names", async () => {
    const { repo } = fakeRepo({
      rows: [
        profile({
          subagentProviderTemplate: "anthropic",
          subagentModel: HAIKU,
        }),
      ],
      owned: [SHARED, ANTHROPIC],
      granted: [SHARED, ANTHROPIC],
    });
    const resolved = await resolve(repo);
    expect(resolved?.pair.settings).toBeUndefined();
    expect(resolved?.subagentUnavailable).toBeNull();
    expect(resolved?.subagent).toEqual({
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": HAIKU,
    });
  });

  /** TEST_SCENARIO: a profile lends its sub-agent as the slot it would be by the one mapping the picker uses too (D193B): its own harness and its sub-agent's model, with the effort it keeps as native `subagentEffort` riding as the slot's effort. */
  it("lends the effort a profile keeps as a slot effort", async () => {
    const { repo } = fakeRepo({
      rows: [
        profile({
          subagentProviderTemplate: "anthropic",
          subagentModel: HAIKU,
          settings: { subagentEffort: "high" },
        }),
      ],
      owned: [SHARED, ANTHROPIC],
      granted: [SHARED, ANTHROPIC],
    });
    expect((await resolve(repo))?.subagent).toEqual({
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": HAIKU,
      "platformSubagent.effort": "high",
    });
  });

  /** TEST_SCENARIO: the profile's sub-agent runs on the agent's Connection of its own template, and its absence is kept apart from the primary's availability: the profile itself still runs, so a slot with a sub-agent of its own is never refused for one it does not use (D193B). */
  it("reports a sub-agent on a provider the agent does not hold beside the primary", async () => {
    const rows = [
      profile({ subagentProviderTemplate: "anthropic", subagentModel: HAIKU }),
    ];
    const unconnected = await resolve(
      fakeRepo({ rows, owned: [SHARED], granted: [SHARED] }).repo,
    );
    expect(unconnected?.unavailable).toBeNull();
    expect(unconnected?.subagentUnavailable).toBe(
      "Anthropic, its sub-agent's provider, is not connected",
    );
    const unattached = await resolve(
      fakeRepo({ rows, owned: [SHARED, ANTHROPIC], granted: [SHARED] }).repo,
    );
    expect(unattached?.unavailable).toBeNull();
    expect(unattached?.subagentUnavailable).toBe(
      "Anthropic, its sub-agent's provider, isn't attached to this agent",
    );
  });
});

describe("the owner's profiles", () => {
  /** TEST_SCENARIO: reading an owner's profiles makes none, so an owner who saved none has none. */
  it("gives an owner no profile", async () => {
    const empty = fakeRepo({ rows: [] });
    expect(await service(empty.repo).list()).toEqual([]);
  });

  /** TEST_SCENARIO: the default for new agents is a profile the owner holds or values of their own that can run: a provider Connection they hold, a harness that runs on it and a model of that provider; while they chose neither, the read names the base default on their shared CurveBender. */
  it("sets the default for new agents to a profile or values of the owner's own", async () => {
    const { repo, state } = fakeRepo({ owned: [SHARED, ANTHROPIC] });
    const svc = service(repo);
    expect(await svc.newAgentDefault()).toEqual({
      profileId: null,
      pair: null,
      base: null,
    });
    await svc.setNewAgentDefault({ profileId: "profile-1" });
    expect(await svc.newAgentDefault()).toMatchObject({
      profileId: "profile-1",
      pair: { harness: "claude-code", provider: SHARED.id },
    });
    const own = {
      harness: "claude-code",
      provider: ANTHROPIC.id,
      model: HAIKU,
    };
    await svc.setNewAgentDefault({ pair: own });
    expect(state.chosen).toEqual({ sessionPair: own });
    expect(
      (await refusal(svc.setNewAgentDefault({ profileId: "profile-other" })))
        .code,
    ).toBe("NOT_FOUND");
    expect(
      (
        await refusal(
          svc.setNewAgentDefault({ pair: { ...own, provider: "conn-gone" } }),
        )
      ).message,
    ).toContain("unknown provider");
    expect(
      (
        await refusal(
          svc.setNewAgentDefault({ pair: { ...own, provider: SHARED.id } }),
        )
      ).message,
    ).toContain("is not a curve-bender-deployment model");
    expect(state.chosen).toEqual({ sessionPair: own });
  });

  /** TEST_SCENARIO: values whose settings no run could take, checked as an agent's chat default checks them, are refused, and the pick before them stays. */
  it("refuses values whose settings cannot run", async () => {
    const { repo, state } = fakeRepo({ owned: [ANTHROPIC] });
    state.chosen = { profileId: "profile-1" };
    const svc = service(repo, {
      settingsProblem: async () =>
        "the claude-code harness cannot keep notASetting as a default",
    });
    const err = await refusal(
      svc.setNewAgentDefault({
        pair: {
          harness: "claude-code",
          provider: ANTHROPIC.id,
          model: HAIKU,
          settings: { notASetting: "x" },
        },
      }),
    );
    expect(err.message).toContain("cannot keep notASetting");
    expect(state.chosen).toEqual({ profileId: "profile-1" });
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

  /** TEST_SCENARIO: the platform sub-agent a profile names is stored beside its model and given back in its view (D193B). */
  it("keeps and returns the platform sub-agent it names", async () => {
    const { repo, writes } = fakeRepo();
    const updated = await service(repo).update({
      id: "profile-1",
      subagent: { providerTemplate: "anthropic", model: HAIKU },
    });
    expect(writes.updates.at(-1)).toMatchObject({
      subagentProviderTemplate: "anthropic",
      subagentModel: HAIKU,
    });
    expect(updated.subagent).toEqual({
      providerTemplate: "anthropic",
      model: HAIKU,
    });
    const cleared = await service(repo).update({
      id: "profile-1",
      subagent: null,
    });
    expect(cleared.subagent).toBeNull();
  });

  /** TEST_SCENARIO: a sub-agent the profile did not name before changes what its slots spawn, so the edit reaches the agents using the profile and a sub-agent none of them can run is put back. */
  it("sends a new sub-agent to the agents using the profile, and puts back one none can run", async () => {
    const { repo, writes } = fakeRepo({
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
    }).update({
      id: "profile-1",
      subagent: { providerTemplate: "anthropic", model: HAIKU },
    });
    expect(republished).toBe(1);
    const err = await refusal(
      service(repo, {
        republish: async () =>
          "Anthropic, its sub-agent's provider, isn't attached to this agent",
      }).update({
        id: "profile-1",
        subagent: {
          providerTemplate: "anthropic",
          model: "anthropic/claude-opus-5",
        },
      }),
    );
    expect(err.message).toContain("sub-agent");
    expect(writes.updates.at(-1)).toMatchObject({
      subagentProviderTemplate: "anthropic",
      subagentModel: HAIKU,
    });
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
  const withPi: Pick<HarnessCatalog, "default" | "harnesses"> = {
    ...catalog,
    harnesses: [
      ...catalog.harnesses,
      {
        name: "pi",
        displayName: "Pi",
        providers: ["curve-bender"],
        tags: [],
        experimental: false,
      },
    ],
  };
  const owner = (repo: ProfilesRepository) => ({
    repo,
    owner: "owner-1",
    catalog: withPi,
    sharedCurveBender: true,
  });
  const BASE_PAIR = {
    harness: "pi",
    provider: SHARED.id,
    model: `cb/${CURVE_BENDER_WORK_MODEL}`,
  };

  /** TEST_SCENARIO: a new agent of an owner whose default for new agents is a profile is granted the owner's Connection of its template, and once it holds it, its chat default is that profile; a Connection the owner holds reconciles nothing. */
  it("starts a new agent on the profile its owner chose", async () => {
    const { repo, writes, state } = fakeRepo();
    state.chosen = { profileId: "profile-1" };
    let reconciled = 0;
    const chosen = await newAgentDefault({
      ...owner(repo),
      reconcileConnections: async () => {
        reconciled += 1;
      },
    });
    expect(chosen).toMatchObject({
      profile: { id: "profile-1" },
      pair: { harness: "claude-code" },
      connectionId: SHARED.id,
    });
    expect(reconciled).toBe(0);
    await bindNewAgentDefault(owner(repo), "agent-1", chosen!);
    expect(writes.binds).toEqual([
      ["agent-1", { sessionProfile: "profile-1" }],
    ]);
  });

  /** TEST_SCENARIO: an owner with no default profile starts a new agent on the base default: Pi on the shared CurveBender's work model, which its chat default holds as values, the way a Custom pick saves it, never as a profile. */
  it("starts a new agent on the base default, saved as values", async () => {
    const { repo, writes } = fakeRepo();
    const chosen = await newAgentDefault(owner(repo));
    expect(chosen).toEqual({
      profile: null,
      pair: BASE_PAIR,
      connectionId: SHARED.id,
    });
    await bindNewAgentDefault(owner(repo), "agent-1", chosen!);
    expect(writes.binds).toEqual([["agent-1", { sessionPair: BASE_PAIR }]]);
  });

  /** TEST_SCENARIO: values the owner chose initialise a new agent's chat default as they are, on the Connection they name; once the owner no longer holds that Connection, the base default takes their place. */
  it("starts a new agent on the owner's own values, else the base default", async () => {
    const own = {
      harness: "claude-code",
      provider: ANTHROPIC.id,
      model: HAIKU,
    };
    const held = fakeRepo({ owned: [SHARED, ANTHROPIC] });
    held.state.chosen = { sessionPair: own };
    const chosen = await newAgentDefault(owner(held.repo));
    expect(chosen).toEqual({
      profile: null,
      pair: own,
      connectionId: ANTHROPIC.id,
    });
    const gone = fakeRepo({ owned: [SHARED] });
    gone.state.chosen = { sessionPair: own };
    expect(await newAgentDefault(owner(gone.repo))).toMatchObject({
      pair: BASE_PAIR,
    });
  });

  /** TEST_SCENARIO: an install without the shared CurveBender, or whose catalog has no Pi, has no base default, so the harness's provider order and the first hello's conversion decide. */
  it("has no base default without the shared CurveBender or Pi", async () => {
    const { repo } = fakeRepo();
    expect(
      await newAgentDefault({ ...owner(repo), sharedCurveBender: false }),
    ).toBeNull();
    expect(await newAgentDefault({ ...owner(repo), catalog })).toBeNull();
  });

  /** TEST_SCENARIO: a create that named another provider keeps it, and the agent's first hello converts its default as before; the binder says why. */
  it("binds nothing to an agent without the default's provider", async () => {
    const { repo, writes } = fakeRepo({ granted: [OWN_KEY] });
    const chosen = (await newAgentDefault(owner(repo)))!;
    expect(await bindNewAgentDefault(owner(repo), "agent-1", chosen)).toMatch(
      /does not hold Connection conn-shared/,
    );
    expect(writes.binds).toEqual([]);
  });

  /** TEST_SCENARIO: the agent's row is written by the agent-created saga, which can run after the create returns, so the bind through the real repository still leaves the new agent's chat default on the profile, or on the base default's values, when that row does not exist yet (QA R1: an UPDATE of the missing row bound nothing). */
  it("binds a new agent whose row the saga has not written yet", async () => {
    const { db, agentRows } = agentsTableDb([SHARED]);
    const repo = createProfilesRepository(db, {
      hashSub: (raw: string) => raw,
    } as never);
    const start = { pair: BASE_PAIR, connectionId: SHARED.id };
    expect(
      await bindNewAgentDefault(owner(repo), "agent-new", {
        ...start,
        profile: profile(),
      }),
    ).toBeNull();
    expect(agentRows.get("agent-new")).toBe("profile-1");
    expect(
      await bindNewAgentDefault(owner(repo), "agent-base", {
        ...start,
        profile: null,
      }),
    ).toBeNull();
    expect(JSON.parse(String(agentRows.get("agent-base")))).toEqual(BASE_PAIR);
  });

  /** TEST_SCENARIO: an owner who holds no Connection of the default's template has nothing to grant, so the harness's provider order decides. */
  it("offers nothing without a Connection of the template", async () => {
    const { repo } = fakeRepo({ owned: [OWN_KEY] });
    expect(await newAgentDefault(owner(repo))).toBeNull();
  });

  /** TEST_SCENARIO: the deployment-owned CurveBender comes from a Connection listing or a boot sweep over owners who already hold one, neither of which a first create through the CLI or API runs, so that create reconciles it and still starts on the base default: Pi on that Connection. */
  it("starts an owner's first agent on Pi over the shared CurveBender it has not listed yet", async () => {
    const owned: AliasedConnection[] = [];
    const { repo } = fakeRepo({ rows: [], owned, granted: [] });
    let reconciled = 0;
    expect(
      await newAgentDefault({
        ...owner(repo),
        reconcileConnections: async () => {
          reconciled += 1;
          owned.push(SHARED);
        },
      }),
    ).toEqual({
      profile: null,
      pair: BASE_PAIR,
      connectionId: SHARED.id,
    });
    expect(reconciled).toBe(1);
  });
});
