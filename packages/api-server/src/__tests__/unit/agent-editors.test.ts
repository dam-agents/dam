// TEST_OVERVIEW: An Agent's owner names Agent Editors by email on its Editor List. An editor finds the Agent through their verified email, listed apart from their own agents and marked with who owns it; anyone else does not find it at all. Only the owner changes the list, the owner's own email cannot go on it, and an editor can take themselves off. Each change tells the people it adds or removes.
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_PERMISSIONS } from "api-server-api";
import type { Subscription } from "rxjs";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import type { AgentEditorsRepository } from "../../modules/agents/infrastructure/agent-editors-repository.js";
import { events$, EventType, type DomainEvent } from "../../events.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const infra = (id: string, owner: string) =>
  parseInfraAgent({
    metadata: { name: id, labels: { "agent-platform.ai/owner": owner } },
    spec: { name: id, image: "example.com/agent:latest" },
  });

const AGENTS = [
  infra("alice-bot", "alice"),
  infra("alice-other", "alice"),
  infra("bob-bot", "bob"),
];

const OWNS = [...AGENT_PERMISSIONS];

const EDITS = [
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

const EMAILS: Record<string, string> = {
  alice: "alice@example.com",
  bob: "bob@example.com",
};

function inMemoryEditors(
  initial: Record<string, string[]>,
): AgentEditorsRepository {
  const lists = new Map(Object.entries(initial));
  const listOf = (id: string) => [...(lists.get(id) ?? [])];
  return {
    list: async (id) => listOf(id),
    listMany: async (ids) => new Map(ids.map((id) => [id, listOf(id)])),
    agentIdsFor: async (email) =>
      [...lists].filter(([, l]) => l.includes(email)).map(([id]) => id),
    async replace(id, emails) {
      const before = listOf(id);
      lists.set(id, [...emails]);
      return {
        editors: [...emails],
        added: emails.filter((e) => !before.includes(e)),
        removed: before.filter((e) => !emails.includes(e)),
      };
    },
    async remove(id, email) {
      const before = listOf(id);
      lists.set(
        id,
        before.filter((e) => e !== email),
      );
      return before.includes(email);
    },
    deleteForAgent: async () => [],
    listAgentIds: async () => [...lists.keys()],
  };
}

function serviceFor(
  caller: { sub: string; editorEmail: string | null },
  editors: AgentEditorsRepository,
) {
  return createAgentsService({
    owner: caller.sub,
    actor: caller.sub,
    editorEmail: caller.editorEmail,
    editors,
    resolveUserEmail: async (sub) => EMAILS[sub] ?? null,
    repo: unused<AgentsDeps["repo"]>({
      list: async (owner) => AGENTS.filter((a) => a.owner === owner),
      get: async (id, owner) =>
        AGENTS.find((a) => a.id === id && (!owner || a.owner === owner)) ??
        null,
      isOwnedBy: async (id, owner) =>
        AGENTS.some((a) => a.id === id && a.owner === owner),
    }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({
      list: async () => [],
      listMany: async (ids) => new Map(ids.map((id) => [id, []])),
    }),
    contributionsProgress: unused<AgentsDeps["contributionsProgress"]>({
      status: async () => {
        throw new Error("no runtime");
      },
      statusMany: async () => new Map(),
    }),
    registrySecretPort: unused(),
    secretRefs: unused(),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentIdleTimeoutMinutes: { container: 30, vm: 5 },
    cleanupHooks: [],
    readTemplateSpec: async () => null,
    runtimeMutator: unused(),
    podStatus: unused(),
    resizeLock: (_key, fn) => fn(),
    listChannelsByOwner: async () => new Map(),
    listChannelsByAgent: async () => [],
    deleteChannelByType: async () => {},
    deleteSlackChannelByAgent: async () => false,
    deleteChannelsByAgentIds: async () => {},
    unitOfWork: unused(),
    channelsTxRepo: unused(),
    resolveSlackWorkspace: async () => ({ kind: "unknown" }),
    findSlackBindings: async () => [],
    onboardingChecklists: { readMany: async () => new Map() },
  });
}

const ALICE = { sub: "alice", editorEmail: "alice@example.com" };
const BOB = { sub: "bob", editorEmail: "bob@example.com" };
const CAROL = { sub: "carol", editorEmail: "carol@example.com" };

let subscription: Subscription | undefined;
afterEach(() => subscription?.unsubscribe());

function recordEvents(): DomainEvent[] {
  const seen: DomainEvent[] = [];
  subscription = events$().subscribe((e) => seen.push(e));
  return seen;
}

describe("listing agents with their access", () => {
  // TEST_SCENARIO: The CLI asks for "mine" and must see exactly the agents the caller owns. The app asks for "all" and also gets the agents shared with the caller, each marked as an editor's, with the owner's email for the "Owned by" line.
  it("adds the agents shared with the caller only when asked for all", async () => {
    const editors = inMemoryEditors({
      "alice-bot": ["bob@example.com", "carol@example.com"],
    });

    const mine = await serviceFor(BOB, editors).listWithAccess("mine");
    expect(mine.map((l) => [l.agent.id, l.access])).toEqual([
      ["bob-bot", { role: "owner", editors: [], permissions: OWNS }],
    ]);

    const all = await serviceFor(BOB, editors).listWithAccess("all");
    expect(all.map((l) => [l.agent.id, l.access])).toEqual([
      ["bob-bot", { role: "owner", editors: [], permissions: OWNS }],
      [
        "alice-bot",
        {
          role: "editor",
          ownerEmail: "alice@example.com",
          editors: ["bob@example.com", "carol@example.com"],
          permissions: EDITS,
        },
      ],
    ]);
  });

  // TEST_SCENARIO: The owner sees which of their agents are shared, and with whom, on their own rows.
  it("gives the owner the editors of each of their agents", async () => {
    const editors = inMemoryEditors({ "alice-bot": ["bob@example.com"] });
    const all = await serviceFor(ALICE, editors).listWithAccess("all");
    expect(all.map((l) => [l.agent.id, l.access])).toEqual([
      [
        "alice-bot",
        { role: "owner", editors: ["bob@example.com"], permissions: OWNS },
      ],
      ["alice-other", { role: "owner", editors: [], permissions: OWNS }],
    ]);
  });

  // TEST_SCENARIO: An email matches only when it is verified. A person signed in with an unverified email, or through an API key, has no editor email and finds nothing shared.
  it("shares nothing with a caller who has no verified email", async () => {
    const editors = inMemoryEditors({ "alice-bot": ["bob@example.com"] });
    const all = await serviceFor(
      { sub: "bob", editorEmail: null },
      editors,
    ).listWithAccess("all");
    expect(all.map((l) => l.agent.id)).toEqual(["bob-bot"]);
  });
});

describe("reading one agent", () => {
  // TEST_SCENARIO: An editor opens the shared agent's page; anyone not on the list gets the same not-found as for an agent that does not exist.
  it("finds a shared agent for its editors and for nobody else", async () => {
    const editors = inMemoryEditors({ "alice-bot": ["bob@example.com"] });

    const asEditor = await serviceFor(BOB, editors).getWithAccess("alice-bot");
    expect(asEditor?.access).toEqual({
      role: "editor",
      ownerEmail: "alice@example.com",
      editors: ["bob@example.com"],
      permissions: EDITS,
    });
    expect(
      await serviceFor(CAROL, editors).getWithAccess("alice-bot"),
    ).toBeNull();
  });
});

describe("changing the Editor List", () => {
  // TEST_SCENARIO: The owner replaces the whole list. The audit trail and the live hints learn exactly who was added and who was removed.
  it("replaces the list and tells each added and removed person", async () => {
    const seen = recordEvents();
    const editors = inMemoryEditors({ "alice-bot": ["bob@example.com"] });

    const res = await serviceFor(ALICE, editors).setEditors("alice-bot", [
      "carol@example.com",
    ]);

    expect(res).toEqual({ ok: true, value: ["carol@example.com"] });
    expect(
      seen.filter((e) => e.type === EventType.AgentEditorsChanged),
    ).toEqual([
      {
        type: EventType.AgentEditorsChanged,
        agentId: "alice-bot",
        ownerSub: "alice",
        emails: ["carol@example.com", "bob@example.com"],
      },
    ]);
  });

  // TEST_SCENARIO: Only the owner changes the list. An editor, or anyone else, is told the agent does not exist, the same answer as for an unknown id.
  it("refuses everyone but the owner", async () => {
    const editors = inMemoryEditors({ "alice-bot": ["bob@example.com"] });
    expect(await serviceFor(BOB, editors).setEditors("alice-bot", [])).toEqual({
      ok: false,
      error: { type: "AgentNotFound" },
    });
    expect(await editors.list("alice-bot")).toEqual(["bob@example.com"]);
  });

  // TEST_SCENARIO: The owner already has every right an editor would get, so their own email on the list is a mistake to point out, not a row to store.
  it("refuses the owner's own email", async () => {
    const editors = inMemoryEditors({});
    expect(
      await serviceFor(ALICE, editors).setEditors("alice-bot", [
        "alice@example.com",
      ]),
    ).toEqual({ ok: false, error: { type: "OwnEmail" } });
  });
});

describe("leaving a shared agent", () => {
  // TEST_SCENARIO: An editor takes their own email off the list and gets the agent's name back for the "You left" message. The owner's sidebar updates through the change's hint.
  it("removes only the caller's own email", async () => {
    const seen = recordEvents();
    const editors = inMemoryEditors({
      "alice-bot": ["bob@example.com", "carol@example.com"],
    });

    expect(await serviceFor(BOB, editors).leave("alice-bot")).toEqual({
      ok: true,
      value: { name: "alice-bot" },
    });
    expect(await editors.list("alice-bot")).toEqual(["carol@example.com"]);
    expect(
      seen.filter((e) => e.type === EventType.AgentEditorsChanged),
    ).toEqual([
      {
        type: EventType.AgentEditorsChanged,
        agentId: "alice-bot",
        ownerSub: "alice",
        emails: ["bob@example.com"],
      },
    ]);
  });

  // TEST_SCENARIO: Someone who is not on the list cannot learn more by trying to leave: the answer is a refusal and nothing changes.
  it("refuses someone who is not an editor", async () => {
    const editors = inMemoryEditors({ "alice-bot": ["bob@example.com"] });
    expect(await serviceFor(CAROL, editors).leave("alice-bot")).toEqual({
      ok: false,
      error: { type: "NotAnEditor" },
    });
    expect(await editors.list("alice-bot")).toEqual(["bob@example.com"]);
  });
});
