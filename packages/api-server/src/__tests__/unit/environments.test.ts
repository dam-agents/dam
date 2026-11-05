// TEST_OVERVIEW: An owning vm Agent creates, lists, changes, wakes and deletes its own Environments, and the owner lists all of them, extends, shares and deletes them. An Environment is an Agent record that names its owning Agent, on the vm backend, with no default model provider and no egress preset, beside a row with its host label, endpoints and expiry; an endpoint may name a readiness path, set at create and changed at update by endpoint name. Only people decide who may open one: the owner names Agent Environment Members for every Environment of an agent and Environment Members for one, while the agent reads only how many people may open each, and its tools refuse an `access` list. The cap per agent, the expiry bound, the vm-only rule and name uniqueness are enforced, an empty update and an expiry outside the date range are refused, and an Environment is never listed as an agent; a `start` command becomes a Startup Item; another owner's Environment is not found. Each endpoint's address is `<endpoint>-<host>` under the install's environments URL, and the host label fits a DNS label with the longest endpoint name.
import { describe, expect, it } from "vitest";
import {
  listedAgents,
  type Agent,
  type AgentCreateInput,
  type AgentsService,
  type AgentUpdateInput,
} from "api-server-api";
import {
  clampExpiry,
  clampIdleTimeout,
  DAY_MS,
  endpointUrl,
  environmentHost,
  HOST_LABEL_MAX,
  type EnvironmentRecord,
} from "../../modules/environments/domain/environment.js";
import type { EnvironmentsRepository } from "../../modules/environments/infrastructure/environments-repository.js";
import {
  parseExpiry,
  parseIdleTimeout,
} from "../../modules/environments/mcp-tools.js";
import type { MembersRepository } from "../../modules/environments/infrastructure/members-repository.js";
import { createEnvironmentsService } from "../../modules/environments/services/environments-service.js";

const OWNER = "owner-1";
const NOW = new Date("2026-10-19T12:00:00Z");

function memoryRepo(): EnvironmentsRepository & { rows: EnvironmentRecord[] } {
  const rows: EnvironmentRecord[] = [];
  return {
    rows,
    insert: async (r) => void rows.push({ ...r }),
    get: async (id) => rows.find((r) => r.agentId === id) ?? null,
    getByHost: async (host) => rows.find((r) => r.host === host) ?? null,
    listByOwningAgent: async (id) => rows.filter((r) => r.owningAgentId === id),
    listByOwner: async (owner) => rows.filter((r) => r.owner === owner),
    listExpired: async (now) =>
      rows.filter((r) => r.expiresAt !== null && r.expiresAt < now),
    listAgentIds: async () => rows.map((r) => r.agentId),
    listOwningAgentIds: async () => [
      ...new Set(rows.map((r) => r.owningAgentId)),
    ],
    findByName: async (owning, name) =>
      rows.find((r) => r.owningAgentId === owning && r.name === name) ?? null,
    update: async (id, patch) => {
      const r = rows.find((x) => x.agentId === id);
      if (r) Object.assign(r, patch);
    },
    delete: async (id) => {
      const i = rows.findIndex((r) => r.agentId === id);
      if (i >= 0) rows.splice(i, 1);
    },
  };
}

function memoryMembers(seed: Record<string, string[]> = {}) {
  const agentLists = new Map(Object.entries(seed));
  const environmentLists = new Map<string, string[]>();
  const agentAgentLists = new Map<string, string[]>();
  const environmentAgentLists = new Map<string, string[]>();
  const visits = new Map<string, Date>();
  const repo: MembersRepository = {
    ofAgent: async (id) => agentLists.get(id) ?? [],
    setOfAgent: async (id, emails) => void agentLists.set(id, emails),
    deleteOfAgent: async (id) => void agentLists.delete(id),
    ofEnvironment: async (id) => environmentLists.get(id) ?? [],
    ofEnvironments: async (ids) =>
      new Map(ids.map((id) => [id, environmentLists.get(id) ?? []])),
    setOfEnvironment: async (id, emails) =>
      void environmentLists.set(id, emails),
    agentsOfAgent: async (id) => agentAgentLists.get(id) ?? [],
    setAgentsOfAgent: async (id, ids) => void agentAgentLists.set(id, ids),
    agentsOfEnvironment: async (id) => environmentAgentLists.get(id) ?? [],
    agentsOfEnvironments: async (ids) =>
      new Map(ids.map((id) => [id, environmentAgentLists.get(id) ?? []])),
    setAgentsOfEnvironment: async (id, ids) =>
      void environmentAgentLists.set(id, ids),
    environmentsSharedWith: async () => [],
    recordVisit: async (env, agent, at) =>
      void visits.set(`${env}|${agent}`, at),
    lastOpened: async (envs, agents) => {
      const out = new Map<string, Date>();
      for (const [key, at] of visits) {
        const [env, agent] = key.split("|") as [string, string];
        if (!envs.includes(env) || !agents.includes(agent)) continue;
        if (!out.has(agent) || out.get(agent)! < at) out.set(agent, at);
      }
      return out;
    },
    forgetMemberAgent: async () => undefined,
    listMemberAgentIds: async () => [],
  };
  return {
    repo,
    agentLists,
    environmentLists,
    agentAgentLists,
    environmentAgentLists,
    visits,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: other owners' Agents, by id, as the agent directory reads them across owners.
const OTHER_AGENTS: Record<
  string,
  { name: string; ownerName: string | null; environment: boolean }
> = {
  "agent-qa00000000000001": {
    name: "qa",
    ownerName: "Bob",
    environment: false,
  },
  "agent-env0000000000099": {
    name: "dev · pr-1",
    ownerName: "Bob",
    environment: true,
  },
};

function fakeAgents(seed: Partial<Agent>[]) {
  const agents = new Map<string, Agent>(
    seed.map((a) => [a.id!, { state: "running", ...a } as Agent]),
  );
  const created: AgentCreateInput[] = [];
  const updated: AgentUpdateInput[] = [];
  const deleted: string[] = [];
  const woken: string[] = [];
  const disabled = new Set<string>();
  let n = 0;
  const service = {
    list: async () => [...agents.values()],
    get: async (id: string) => agents.get(id) ?? null,
    create: async (input: AgentCreateInput) => {
      created.push(input);
      const id = `agent-env${String(++n).padStart(13, "0")}`;
      const agent = {
        id,
        name: input.name,
        state: "starting",
        effectiveHibernationTimeoutMin: input.hibernationTimeoutMin ?? 5,
        spec: {
          backend: { type: "vm" },
          environmentOf: input.environmentOf,
        },
      } as unknown as Agent;
      agents.set(id, agent);
      return agent;
    },
    update: async (input: AgentUpdateInput) => {
      updated.push(input);
      const agent = agents.get(input.id);
      if (!agent) return null;
      if (typeof input.hibernationTimeoutMin === "number")
        agent.effectiveHibernationTimeoutMin = input.hibernationTimeoutMin;
      return agent;
    },
    delete: async (id: string) => {
      deleted.push(id);
      agents.delete(id);
    },
    wake: async (id: string) => {
      if (disabled.has(id))
        return { ok: false, error: { type: "AgentDisabled" } };
      woken.push(id);
      return { ok: true, value: agents.get(id) };
    },
  } as unknown as AgentsService;
  return { service, created, updated, deleted, woken, disabled };
}

const vmOwning = {
  id: "agent-owning0000000001",
  name: "dev",
  spec: { backend: { type: "vm" } },
} as unknown as Partial<Agent>;

function setup(
  opts: {
    agents?: Partial<Agent>[];
    max?: number;
    agentMembers?: Record<string, string[]>;
    editors?: string[];
  } = {},
) {
  const repo = memoryRepo();
  const agents = fakeAgents(opts.agents ?? [vmOwning]);
  const starts: [string, string][] = [];
  const members = memoryMembers(opts.agentMembers);
  const service = createEnvironmentsService({
    owner: OWNER,
    repo,
    members: members.repo,
    editorsOf: async () => opts.editors ?? [],
    directory: {
      describe: async (id) =>
        OTHER_AGENTS[id] ??
        (id === vmOwning.id
          ? { name: "dev", ownerName: "Alice", environment: false }
          : null),
      environmentState: async () => "running",
    },
    agents: agents.service,
    config: {
      urlTemplate: "https://{host}.env.example.com",
      maxPerAgent: opts.max ?? 5,
      expiryMaxDays: 30,
      idleTimeoutDefaultMin: 60,
      idleTimeoutMaxMin: 1440,
    },
    startCommand: async (id, command) => void starts.push([id, command]),
    now: () => NOW,
  });
  return { repo, agents, starts, woken: agents.woken, service, members };
}

describe("creating an Environment", () => {
  // TEST_SCENARIO: the Environment is a vm Agent record naming its owning Agent, with nothing that lets it act as that Agent: no default model provider and no egress preset. Its endpoints get addresses under the install's URL, its start command becomes a Startup Item, and it expires a week from now by default.
  it("creates a vm Agent naming its owner, with addresses, a start command and a default expiry", async () => {
    const { service, agents, starts, repo } = setup();

    const env = await service.forOwningAgent(vmOwning.id!).create({
      name: "pr-42",
      endpoints: [
        { name: "app", port: 4444 },
        { name: "keycloak", port: 8080 },
      ],
      start: "docker compose up",
    });

    expect(agents.created[0]).toMatchObject({
      name: "dev · pr-42",
      environmentOf: vmOwning.id,
      noDefaultProvider: true,
      egressPreset: "none",
      hibernationTimeoutMin: 60,
    });
    const host = repo.rows[0]!.host;
    expect(host).toMatch(/^pr-42-[0-9a-f]{6}$/);
    expect(env.endpoints).toEqual([
      { name: "app", port: 4444, url: `https://app-${host}.env.example.com` },
      {
        name: "keycloak",
        port: 8080,
        url: `https://keycloak-${host}.env.example.com`,
      },
    ]);
    expect(starts).toEqual([[env.id, "docker compose up"]]);
    expect(env.expiresAt).toBe(
      new Date(NOW.getTime() + 7 * DAY_MS).toISOString(),
    );
    expect(env.peopleWhoMayOpen).toBe(0);
    expect(env.idleTimeoutMin).toBe(60);
  });

  // TEST_SCENARIO: an Environment's services take far longer to come back than an agent's, so the owning Agent may give it an idle timeout of its own; one past the install's maximum is cut down to it, and zero minutes is refused before any Agent is created, since only "never" turns sleep off.
  it("takes an idle timeout, cut to the maximum, and refuses zero", async () => {
    const { service, agents } = setup();
    const mine = service.forOwningAgent(vmOwning.id!);
    const endpoints = [{ name: "app", port: 80 }];

    const short = await mine.create({
      name: "a",
      endpoints,
      idleTimeoutMin: 90,
    });
    const long = await mine.create({
      name: "b",
      endpoints,
      idleTimeoutMin: 3 * 1440,
    });
    await expect(
      mine.create({ name: "c", endpoints, idleTimeoutMin: 0 }),
    ).rejects.toThrow(/at least one minute/);

    expect(agents.created.map((c) => c.hibernationTimeoutMin)).toEqual([
      90, 1440,
    ]);
    expect([short.idleTimeoutMin, long.idleTimeoutMin]).toEqual([90, 1440]);
    expect((await mine.list()).map((e) => [e.name, e.idleTimeoutMin])).toEqual([
      ["a", 90],
      ["b", 1440],
    ]);
  });

  // TEST_SCENARIO: AC-3 — the owning Agent creates an Environment that never sleeps, for a server people rely on: its Agent is written with a zero hibernation timeout, which the controller reads as never sleeping, the install's maximum does not cut it, and the agent's list says "never"; a later update gives it a timeout again.
  it("creates an Environment that never sleeps, and gives it a timeout again", async () => {
    const { service, agents } = setup();
    const mine = service.forOwningAgent(vmOwning.id!);

    const env = await mine.create({
      name: "mcp",
      endpoints: [{ name: "app", port: 80 }],
      idleTimeoutMin: "never",
    });

    expect(agents.created[0]!.hibernationTimeoutMin).toBe(0);
    expect(env.idleTimeoutMin).toBe("never");
    expect((await mine.list())[0]!.idleTimeoutMin).toBe("never");
    expect((await service.listAll())[0]!.idleTimeoutMin).toBe("never");

    const changed = await mine.update("mcp", { idleTimeoutMin: 90 });
    expect(agents.updated.at(-1)).toEqual({
      id: env.id,
      hibernationTimeoutMin: 90,
    });
    expect(changed.idleTimeoutMin).toBe(90);
    const again = await mine.update("mcp", { idleTimeoutMin: "never" });
    expect(agents.updated.at(-1)!.hibernationTimeoutMin).toBe(0);
    expect(again.idleTimeoutMin).toBe("never");
  });

  // TEST_SCENARIO: only a vm Agent can own Environments, since they run on its owner's VM runner beside it, and an Environment cannot own one in turn.
  it("refuses an Environment as the owner", async () => {
    const env = {
      id: "agent-environment00001",
      name: "e",
      spec: { backend: { type: "vm" }, environmentOf: vmOwning.id },
    } as unknown as Partial<Agent>;
    const { service, agents } = setup({ agents: [env] });
    const endpoints = [{ name: "app", port: 80 }];

    await expect(
      service.forOwningAgent(env.id!).create({ name: "a", endpoints }),
    ).rejects.toThrow(/cannot own/);
    expect(agents.created).toHaveLength(0);
  });

  // TEST_SCENARIO: an agent holds at most the install's number of Environments, each name once.
  it("refuses a name it already uses and an Environment past the cap", async () => {
    const { service } = setup({ max: 1 });
    const mine = service.forOwningAgent(vmOwning.id!);
    const endpoints = [{ name: "app", port: 80 }];
    await mine.create({ name: "a", endpoints });

    await expect(mine.create({ name: "a", endpoints })).rejects.toThrow(
      /already exists/,
    );
    await expect(mine.create({ name: "b", endpoints })).rejects.toThrow(
      /the most it may/,
    );
  });

  // TEST_SCENARIO: two creates at once cannot both pass the cap: each counts again once its row is written, and one that finds the agent over the cap deletes its Environment and is refused.
  it("holds the cap against creates that run at once", async () => {
    const { service } = setup({ max: 1 });
    const mine = service.forOwningAgent(vmOwning.id!);
    const endpoints = [{ name: "app", port: 80 }];

    const results = await Promise.allSettled([
      mine.create({ name: "a", endpoints }),
      mine.create({ name: "b", endpoints }),
    ]);

    expect(
      results.filter((r) => r.status === "fulfilled").length,
    ).toBeLessThanOrEqual(1);
    expect((await mine.list()).length).toBeLessThanOrEqual(1);
  });

  // TEST_SCENARIO: a record that cannot be written leaves no Environment Agent behind.
  it("deletes the Agent again when its row cannot be written", async () => {
    const { service, repo, agents } = setup();
    repo.insert = async () => {
      throw new Error("db down");
    };

    await expect(
      service
        .forOwningAgent(vmOwning.id!)
        .create({ name: "a", endpoints: [{ name: "app", port: 80 }] }),
    ).rejects.toThrow("db down");
    expect(agents.deleted).toHaveLength(1);
  });
});

describe("changing and deleting Environments", () => {
  // TEST_SCENARIO: the owning Agent changes and deletes its Environments by name, and its owner by id; an expiry past the install's maximum is cut to it, one in the past refused.
  it("extends and deletes", async () => {
    const { service, agents, repo } = setup();
    const mine = service.forOwningAgent(vmOwning.id!);
    const env = await mine.create({
      name: "a",
      endpoints: [{ name: "app", port: 80 }],
    });

    const updated = await mine.update("a", {
      expiresAt: new Date(NOW.getTime() + 90 * DAY_MS),
    });
    expect(updated.expiresAt).toBe(
      new Date(NOW.getTime() + 30 * DAY_MS).toISOString(),
    );
    await expect(
      service.extend(env.id, new Date(NOW.getTime() - 1)),
    ).rejects.toThrow(/future/);

    await service.delete(env.id);
    expect(agents.deleted).toEqual([env.id]);
    expect(repo.rows).toHaveLength(0);
  });

  // TEST_SCENARIO: AC-1, AC-2 — the owner and the owning Agent may both keep an Environment with no expiry, and the last change wins, whoever made it: the agent creates one that never expires, the owner gives it a date, the agent turns it off again, and the owner does too. A kept one has no expiry in its row, the agent reads "never" and the owner's view null, as an artifact kept with no expiry.
  it("keeps an Environment with no expiry, the last change winning", async () => {
    const { service, repo } = setup();
    const mine = service.forOwningAgent(vmOwning.id!);

    const env = await mine.create({
      name: "mcp",
      endpoints: [{ name: "app", port: 80 }],
      expiresAt: "never",
    });
    expect(env.expiresAt).toBe("never");
    expect(repo.rows[0]!.expiresAt).toBeNull();
    expect((await service.listAll())[0]!.expiresAt).toBeNull();

    const dated = await service.extend(
      env.id,
      new Date(NOW.getTime() + DAY_MS),
    );
    expect(dated.expiresAt).toBe(
      new Date(NOW.getTime() + DAY_MS).toISOString(),
    );

    expect((await mine.update("mcp", { expiresAt: "never" })).expiresAt).toBe(
      "never",
    );
    expect(repo.rows[0]!.expiresAt).toBeNull();

    await service.extend(env.id, new Date(NOW.getTime() + DAY_MS));
    const kept = await service.extend(env.id, "never");
    expect(kept.expiresAt).toBeNull();
    expect(repo.rows[0]!.expiresAt).toBeNull();
  });

  // TEST_SCENARIO: an endpoint declares its readiness path at create, and the owning Agent sets, changes or removes one by endpoint name later, leaving the others as they were; a name that is no endpoint is refused and nothing changes.
  it("sets readiness paths at create and update", async () => {
    const { service, repo } = setup();
    const mine = service.forOwningAgent(vmOwning.id!);
    const env = await mine.create({
      name: "a",
      endpoints: [
        { name: "app", port: 80, ready: "/healthz" },
        { name: "auth", port: 81 },
      ],
    });
    expect(env.endpoints.map((e) => e.ready)).toEqual(["/healthz", undefined]);

    const updated = await mine.update("a", {
      ready: { app: null, auth: "/realms/x" },
    });
    expect(updated.endpoints.map((e) => e.ready)).toEqual([
      undefined,
      "/realms/x",
    ]);
    expect(repo.rows[0]!.endpoints).toEqual([
      { name: "app", port: 80 },
      { name: "auth", port: 81, ready: "/realms/x" },
    ]);

    await expect(mine.update("a", { ready: { web: "/" } })).rejects.toThrow(
      /no endpoint named web/,
    );
    expect(repo.rows[0]!.endpoints[1]!.ready).toBe("/realms/x");
  });

  // TEST_SCENARIO: the owning Agent changes an existing Environment's idle timeout on its Agent, alone or with the expiry; an idle timeout alone leaves the expiry as it was, one beside readiness paths sets both, one past the maximum is cut, and zero is refused with nothing changed.
  it("changes the idle timeout of an existing Environment", async () => {
    const { service, agents, repo } = setup();
    const mine = service.forOwningAgent(vmOwning.id!);
    const env = await mine.create({
      name: "a",
      endpoints: [{ name: "app", port: 80 }],
    });

    const changed = await mine.update("a", { idleTimeoutMin: 240 });
    expect(changed.idleTimeoutMin).toBe(240);
    expect(changed.expiresAt).toBe(env.expiresAt);
    expect(repo.rows[0]!.expiresAt!.toISOString()).toBe(env.expiresAt);

    const both = await mine.update("a", {
      idleTimeoutMin: 10_000,
      expiresAt: new Date(NOW.getTime() + DAY_MS),
    });
    expect(both.idleTimeoutMin).toBe(1440);
    expect(both.expiresAt).toBe(new Date(NOW.getTime() + DAY_MS).toISOString());

    await expect(mine.update("a", { idleTimeoutMin: 0 })).rejects.toThrow(
      /at least one minute/,
    );
    const withReady = await mine.update("a", {
      idleTimeoutMin: 30,
      ready: { app: "/healthz" },
    });
    expect(withReady.idleTimeoutMin).toBe(30);
    expect(repo.rows[0]!.endpoints[0]!.ready).toBe("/healthz");
    expect(withReady.expiresAt).toBe(both.expiresAt);

    expect(agents.updated).toEqual([
      { id: env.id, hibernationTimeoutMin: 240 },
      { id: env.id, hibernationTimeoutMin: 1440 },
      { id: env.id, hibernationTimeoutMin: 30 },
    ]);
  });

  // TEST_SCENARIO: the owner names the agent's members once, for every Environment it has or creates later, and adds a person to one Environment only; the owner's view of each Environment lists its own members and counts the agent's, so the Share dialog can say who is in through the agent. The agent's own view says only how many people may open each, editors included, never who.
  it("adds people for every Environment of an agent, or for one", async () => {
    const { service, members } = setup({ editors: ["ed@example.com"] });
    const mine = service.forOwningAgent(vmOwning.id!);
    const endpoints = [{ name: "app", port: 80 }];
    const first = await mine.create({ name: "a", endpoints });
    await mine.create({ name: "b", endpoints });

    expect(
      await service.setAgentMembers(vmOwning.id!, {
        emails: ["a@example.com", "b@example.com", "a@example.com"],
      }),
    ).toEqual({ emails: ["a@example.com", "b@example.com"], agents: [] });
    expect(await service.agentMembers(vmOwning.id!)).toEqual({
      emails: ["a@example.com", "b@example.com"],
      agents: [],
    });
    const shared = await service.setMembers(first.id, {
      emails: ["c@example.com"],
    });
    expect(shared).toMatchObject({
      members: ["c@example.com"],
      agentMemberCount: 2,
    });
    expect(members.environmentLists.get(first.id)).toEqual(["c@example.com"]);

    const owners = await service.list(vmOwning.id!);
    expect(owners.map((e) => [e.name, e.members, e.agentMemberCount])).toEqual([
      ["a", ["c@example.com"], 2],
      ["b", [], 2],
    ]);
    const agentView = await mine.list();
    expect(agentView.map((e) => [e.name, e.peopleWhoMayOpen])).toEqual([
      ["a", 4],
      ["b", 3],
    ]);
    expect(agentView[0]).not.toHaveProperty("members");
  });

  // TEST_SCENARIO: the Artifacts page lists every Environment of the owner, across agents, and none of another owner's; one whose Agent is gone is left out.
  it("lists all of the owner's Environments", async () => {
    const other = {
      id: "agent-owning0000000002",
      name: "qa",
      spec: { backend: { type: "vm" } },
    } as unknown as Partial<Agent>;
    const { service, repo } = setup({ agents: [vmOwning, other] });
    const endpoints = [{ name: "app", port: 80 }];
    await service.forOwningAgent(vmOwning.id!).create({ name: "a", endpoints });
    await service.forOwningAgent(other.id!).create({ name: "b", endpoints });
    repo.rows.push({
      ...repo.rows[0]!,
      agentId: "agent-foreign000000001",
      owner: "someone-else",
    });

    expect((await service.listAll()).map((e) => e.name)).toEqual(["a", "b"]);
  });

  // TEST_SCENARIO: the owner shares only their own Environment; another owner's is not found.
  it("does not share another owner's Environment", async () => {
    const { service, repo, members } = setup();
    repo.rows.push({
      agentId: "agent-foreign000000001",
      owningAgentId: vmOwning.id!,
      owner: "someone-else",
      name: "theirs",
      host: "theirs-abcdef",
      endpoints: [],
      expiresAt: NOW,
      createdAt: NOW,
    });

    await expect(
      service.setMembers("agent-foreign000000001", {
        emails: ["x@example.com"],
      }),
    ).rejects.toThrow(/no such Environment/);
    expect(members.environmentLists.size).toBe(0);
  });

  // TEST_SCENARIO: the owning Agent wakes a sleeping Environment by name before it opens the Environment Link, which reaches only a running machine; a name it does not own wakes nothing, and one its owner turned off is refused with that reason, never reported as waking.
  it("wakes its own Environment by name", async () => {
    const { service, woken, agents } = setup();
    const mine = service.forOwningAgent(vmOwning.id!);
    const env = await mine.create({
      name: "a",
      endpoints: [{ name: "app", port: 80 }],
    });

    await mine.wake("a");
    expect(woken).toEqual([env.id]);
    await expect(mine.wake("b")).rejects.toThrow(/no Environment named/);
    expect(woken).toEqual([env.id]);
    agents.disabled.add(env.id);
    await expect(mine.wake("a")).rejects.toThrow(/turned off by your owner/);
  });

  // TEST_SCENARIO: another owner's Environment is not found, by id or by name.
  it("does not find another owner's Environment", async () => {
    const { service, repo } = setup();
    repo.rows.push({
      agentId: "agent-foreign000000001",
      owningAgentId: vmOwning.id!,
      owner: "someone-else",
      name: "theirs",
      host: "theirs-abcdef",
      endpoints: [],
      expiresAt: NOW,
      createdAt: NOW,
    });

    await expect(service.delete("agent-foreign000000001")).rejects.toThrow(
      /no such Environment/,
    );
    await expect(
      service.forOwningAgent(vmOwning.id!).delete("theirs"),
    ).rejects.toThrow(/no Environment named/);
  });
});

describe("refusing what cannot be stored", () => {
  // TEST_SCENARIO: an update that names an Environment and changes nothing is refused as a bad request before it reaches the database, which would throw on an empty change set.
  it("refuses an update with nothing to change", async () => {
    const { service } = setup();
    const mine = service.forOwningAgent(vmOwning.id!);
    await mine.create({ name: "a", endpoints: [{ name: "app", port: 80 }] });

    await expect(mine.update("a", {})).rejects.toThrow(/nothing to change/);
  });

  // TEST_SCENARIO: a relative expiry so large it leaves the date range is refused where it is parsed, and a date that is not one is refused by the clamp, so an Invalid Date never reaches the database or a response.
  it("refuses an expiry outside the date range", () => {
    expect(() => parseExpiry("9999999999d")).toThrow(/not a date/);
    expect(() => parseExpiry("soon")).toThrow(/not a date/);
    expect(parseExpiry(" never ")).toBe("never");
    expect(clampExpiry("never", NOW, 30)).toBeNull();
    expect((parseExpiry("48h") as Date).getTime()).toBeGreaterThan(Date.now());
    expect(clampExpiry(new Date(Number.NaN), NOW, 30)).toEqual({
      error: "the expiry is not a date",
    });
  });
});

describe("Environment idle timeouts", () => {
  // TEST_SCENARIO: an agent writes an idle timeout as it writes an expiry, in minutes, hours or days, and the tool reads it as whole minutes; "never" and a zero, bare or with a unit, read as never sleeping, and any other word, bare number or a negative one is refused where it is parsed, with a message.
  it("parses minutes, hours and days, and refuses anything else", () => {
    expect(parseIdleTimeout(undefined)).toBeUndefined();
    expect(parseIdleTimeout("90m")).toBe(90);
    expect(parseIdleTimeout("4h")).toBe(240);
    expect(parseIdleTimeout(" 2d ")).toBe(2880);
    for (const value of ["never", "Never", "0", "0m", "00h"])
      expect(parseIdleTimeout(value)).toBe("never");
    for (const value of ["off", "60", "-5m", "1.5h", ""])
      expect(() => parseIdleTimeout(value)).toThrow(/idle_timeout/);
    expect(() => parseIdleTimeout(`${"9".repeat(20)}d`)).toThrow(/too long/);
  });

  // TEST_SCENARIO: the idle timeout is the install's default for Environments when none is asked for, at most the install's maximum, and never zero or less as a number; "never" is zero, which the maximum does not cut.
  it("defaults, caps and refuses zero", () => {
    expect(clampIdleTimeout(undefined, 60, 1440)).toBe(60);
    expect(clampIdleTimeout(90, 60, 1440)).toBe(90);
    expect(clampIdleTimeout("never", 60, 1440)).toBe(0);
    expect(clampIdleTimeout(1441, 60, 1440)).toBe(1440);
    for (const zero of [0, -1])
      expect(clampIdleTimeout(zero, 60, 1440)).toEqual({
        error: expect.stringMatching(/at least one minute/),
      });
  });
});

describe("listing agents", () => {
  // TEST_SCENARIO: an Environment is never listed as an agent, on any surface that lists agents — the app, the CLI and an API key's agent picker all list through the same rule — and a key bound to some agents lists only those.
  it("leaves Environments out of the agents a caller lists", () => {
    const agents = [
      { id: "agent-a", spec: {} },
      { id: "agent-b", spec: {} },
      { id: "agent-env", spec: { environmentOf: "agent-a" } },
    ] as unknown as Agent[];

    expect(listedAgents(agents, "*").map((a) => a.id)).toEqual([
      "agent-a",
      "agent-b",
    ]);
    expect(
      listedAgents(agents, ["agent-b", "agent-env"]).map((a) => a.id),
    ).toEqual(["agent-b"]);
  });
});

describe("Environment addresses", () => {
  // TEST_SCENARIO: the longest endpoint name, a hyphen and the host label fit a DNS label of 63 characters, however long the Environment's name; trailing hyphens of a cut name are dropped.
  it("keeps every address within one DNS label", () => {
    const host = environmentHost("x".repeat(24), "abcdef");
    expect(`${"e".repeat(12)}-${host}`.length).toBeLessThanOrEqual(
      HOST_LABEL_MAX,
    );
    expect(environmentHost("pr-42", "abcdef")).toBe("pr-42-abcdef");
  });

  // TEST_SCENARIO: an install without an environments domain has no URL, and its Environments no addresses.
  it("has no address without an environments URL", () => {
    expect(endpointUrl(null, "app", "pr-42-abcdef")).toBeNull();
    expect(
      endpointUrl("http://{host}.env.localhost:4444", "app", "pr-42-abcdef"),
    ).toBe("http://app-pr-42-abcdef.env.localhost:4444");
  });

  // TEST_SCENARIO: an expiry is in the future and at most the maximum ahead.
  it("bounds the expiry", () => {
    expect(clampExpiry(new Date(NOW.getTime() - 1), NOW, 30)).toEqual({
      error: "the expiry must be in the future",
    });
    expect(clampExpiry(new Date(NOW.getTime() + DAY_MS), NOW, 30)).toEqual(
      new Date(NOW.getTime() + DAY_MS),
    );
  });
});

describe("agents on an Environment's lists", () => {
  // TEST_SCENARIO: the owner adds another user's QA agent by its id in an Environment's Share dialog. The list then shows the agent by name and whose it is, with when it last opened the Environment, and the agent's own view still says only how many people may open it, never which agents.
  it("adds an agent of any owner by id and shows it by name and owner", async () => {
    const { service, members } = setup();
    const env = await service
      .forOwningAgent(vmOwning.id!)
      .create({ name: "a", endpoints: [{ name: "app", port: 80 }] });
    await members.repo.recordVisit(env.id, "agent-qa00000000000001", NOW);

    const view = await service.setMembers(env.id, {
      emails: [],
      agentIds: [" agent-qa00000000000001 ", "agent-qa00000000000001"],
    });
    expect(view.memberAgents).toEqual([
      {
        agentId: "agent-qa00000000000001",
        name: "qa",
        ownerName: "Bob",
        lastOpenedAt: NOW.toISOString(),
      },
    ]);
    expect(members.environmentAgentLists.get(env.id)).toEqual([
      "agent-qa00000000000001",
    ]);
  });

  // TEST_SCENARIO: the owner types an id that names no agent, or names an Environment. Nothing is saved, people included, and the refusal names the id, so a list never holds an entry that opens nothing.
  it("refuses an id that is not an agent that can open an Environment", async () => {
    const { service, members } = setup();
    const env = await service
      .forOwningAgent(vmOwning.id!)
      .create({ name: "a", endpoints: [{ name: "app", port: 80 }] });
    for (const id of ["agent-missing00000001", "agent-env0000000000099"])
      await expect(
        service.setMembers(env.id, {
          emails: ["p@example.com"],
          agentIds: [id],
        }),
      ).rejects.toThrow(`${id} is not an agent that can open an Environment`);
    expect(members.environmentLists.get(env.id)).toBeUndefined();
    expect(await service.lookupAgent("agent-env0000000000099")).toEqual({
      found: false,
    });
    expect(await service.lookupAgent("agent-qa00000000000001")).toEqual({
      found: true,
      agentId: "agent-qa00000000000001",
      name: "qa",
      ownerName: "Bob",
    });
  });

  // TEST_SCENARIO: an older client saves only people. The agents already on the list stay, since an omitted agent list is not an empty one.
  it("keeps the agents when a save names only people", async () => {
    const { service, members } = setup();
    await service.setAgentMembers(vmOwning.id!, {
      emails: [],
      agentIds: ["agent-qa00000000000001"],
    });
    const after = await service.setAgentMembers(vmOwning.id!, {
      emails: ["a@example.com"],
    });
    expect(after.agents.map((a) => a.agentId)).toEqual([
      "agent-qa00000000000001",
    ]);
    expect(members.agentAgentLists.get(vmOwning.id!)).toEqual([
      "agent-qa00000000000001",
    ]);
  });
});
