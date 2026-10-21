// TEST_OVERVIEW: An owning vm Agent creates, lists, changes, wakes and deletes its own Environments, and the owner extends and deletes them. An Environment is an Agent record that names its owning Agent, on the vm backend, with no default model provider and no egress preset, beside a row with its host label, endpoints, access list and expiry. The cap per agent, the expiry bound, the vm-only rule and name uniqueness are enforced, an empty update and an expiry outside the date range are refused, and an Environment is never listed as an agent; a `start` command becomes a Startup Item; another owner's Environment is not found. Each endpoint's address is `<endpoint>-<host>` under the install's environments URL, and the host label fits a DNS label with the longest endpoint name.
import { describe, expect, it } from "vitest";
import {
  listedAgents,
  type Agent,
  type AgentCreateInput,
  type AgentsService,
} from "api-server-api";
import {
  clampExpiry,
  DAY_MS,
  endpointUrl,
  environmentHost,
  HOST_LABEL_MAX,
  type EnvironmentRecord,
} from "../../modules/environments/domain/environment.js";
import type { EnvironmentsRepository } from "../../modules/environments/infrastructure/environments-repository.js";
import { parseExpiry } from "../../modules/environments/mcp-tools.js";
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
    listExpired: async (now) => rows.filter((r) => r.expiresAt < now),
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

function fakeAgents(seed: Partial<Agent>[]) {
  const agents = new Map<string, Agent>(
    seed.map((a) => [a.id!, { state: "running", ...a } as Agent]),
  );
  const created: AgentCreateInput[] = [];
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
        spec: {
          backend: { type: "vm" },
          environmentOf: input.environmentOf,
        },
      } as unknown as Agent;
      agents.set(id, agent);
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
  return { service, created, deleted, woken, disabled };
}

const vmOwning = {
  id: "agent-owning0000000001",
  name: "dev",
  spec: { backend: { type: "vm" } },
} as unknown as Partial<Agent>;

function setup(opts: { agents?: Partial<Agent>[]; max?: number } = {}) {
  const repo = memoryRepo();
  const agents = fakeAgents(opts.agents ?? [vmOwning]);
  const starts: [string, string][] = [];
  const service = createEnvironmentsService({
    owner: OWNER,
    repo,
    agents: agents.service,
    config: {
      urlTemplate: "https://{host}.env.example.com",
      maxPerAgent: opts.max ?? 5,
      expiryMaxDays: 30,
    },
    startCommand: async (id, command) => void starts.push([id, command]),
    now: () => NOW,
  });
  return { repo, agents, starts, woken: agents.woken, service };
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
      vm: true,
      environmentOf: vmOwning.id,
      noDefaultProvider: true,
      egressPreset: "none",
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
    expect(env.access).toBeNull();
  });

  // TEST_SCENARIO: only a vm Agent can own Environments, since they run on its owner's VM runner beside it, and an Environment cannot own one in turn.
  it("refuses a container agent and an Environment as the owner", async () => {
    const container = {
      id: "agent-container0000001",
      name: "c",
      spec: {},
    } as unknown as Partial<Agent>;
    const env = {
      id: "agent-environment00001",
      name: "e",
      spec: { backend: { type: "vm" }, environmentOf: vmOwning.id },
    } as unknown as Partial<Agent>;
    const { service, agents } = setup({ agents: [container, env] });
    const endpoints = [{ name: "app", port: 80 }];

    await expect(
      service.forOwningAgent(container.id!).create({ name: "a", endpoints }),
    ).rejects.toThrow(/vm backend/);
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
  it("extends, narrows access and deletes", async () => {
    const { service, agents, repo } = setup();
    const mine = service.forOwningAgent(vmOwning.id!);
    const env = await mine.create({
      name: "a",
      endpoints: [{ name: "app", port: 80 }],
    });

    const updated = await mine.update("a", {
      expiresAt: new Date(NOW.getTime() + 90 * DAY_MS),
      access: ["reviewer@example.com"],
    });
    expect(updated.expiresAt).toBe(
      new Date(NOW.getTime() + 30 * DAY_MS).toISOString(),
    );
    expect(updated.access).toEqual(["reviewer@example.com"]);
    await expect(
      service.extend(env.id, new Date(NOW.getTime() - 1)),
    ).rejects.toThrow(/future/);

    await service.delete(env.id);
    expect(agents.deleted).toEqual([env.id]);
    expect(repo.rows).toHaveLength(0);
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
      access: null,
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
    expect(parseExpiry("48h")!.getTime()).toBeGreaterThan(Date.now());
    expect(clampExpiry(new Date(Number.NaN), NOW, 30)).toEqual({
      error: "the expiry is not a date",
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
