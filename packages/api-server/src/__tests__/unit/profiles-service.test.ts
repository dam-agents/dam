import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { HarnessCatalog, ProfileUsage } from "api-server-api";
import type {
  DeleteOutcome,
  ProfileRow,
  ProfileWrite,
  ProfilesRepository,
} from "../../modules/profiles/infrastructure/profiles-repository.js";
import {
  createProfilesService,
  type SeededProvider,
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
    {
      name: "bob",
      displayName: "Bob",
      providers: ["bob"],
      tags: [],
      experimental: false,
    },
  ],
};

const shared: SeededProvider = {
  providerTemplate: "curve-bender-deployment",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
};

const emptyUsage = (): ProfileUsage => ({
  agents: [],
  channels: [],
  schedules: [],
});

function row(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "profile-1",
    owner: "owner-1",
    name: "Default",
    seed: "seeded-default",
    harness: "claude-code",
    providerTemplate: "curve-bender-deployment",
    model: shared.model,
    settings: {},
    createdAt: new Date("2026-10-25T00:00:00Z"),
    updatedAt: new Date("2026-10-25T00:00:00Z"),
    ...overrides,
  };
}

interface Fake {
  repo: ProfilesRepository;
  calls: {
    seeds: (ProfileWrite | null)[];
    inserts: ProfileWrite[];
    updates: { id: string; profile: Partial<ProfileWrite> }[];
    binds: { agentId: string; profileId: string }[];
    deleted: string[];
  };
  rows: ProfileRow[];
}

function fakeRepo(opts: {
  rows?: ProfileRow[];
  seeded?: ProfileRow | null;
  usage?: ProfileUsage;
  deleteOutcome?: DeleteOutcome;
  holds?: boolean;
  counts?: Map<string, { agents: number; channels: number; schedules: number }>;
}): Fake {
  const rows = [...(opts.rows ?? [])];
  const calls: Fake["calls"] = {
    seeds: [],
    inserts: [],
    updates: [],
    binds: [],
    deleted: [],
  };
  const repo: ProfilesRepository = {
    list: async () => rows,
    get: async (_owner, id) => rows.find((r) => r.id === id) ?? null,
    seeded: async () => opts.seeded ?? null,
    insert: async (_owner, profile) => {
      calls.inserts.push(profile);
      const inserted = row({
        id: `profile-${rows.length + 2}`,
        seed: null,
        ...profile,
      });
      rows.push(inserted);
      return inserted;
    },
    update: async (_owner, id, profile) => {
      calls.updates.push({ id, profile });
      const current = rows.find((r) => r.id === id);
      if (!current) return null;
      return { ...current, ...profile, updatedAt: new Date() };
    },
    deleteIfUnused: async (_owner, id) => {
      calls.deleted.push(id);
      return opts.deleteOutcome ?? { outcome: "deleted" };
    },
    usage: async () => opts.usage ?? emptyUsage(),
    usageCounts: async () => opts.counts ?? new Map(),
    seed: async (_owner, profile) => {
      calls.seeds.push(profile);
    },
    bindChatProfile: async (_owner, agentId, profileId) => {
      calls.binds.push({ agentId, profileId });
    },
    holdsTemplate: async () => opts.holds ?? true,
    ownerConnections: async () => [],
    agentConnections: async () => [],
  };
  return { repo, calls, rows };
}

function service(
  fake: Fake,
  opts: { seededProvider?: SeededProvider | null } = {},
) {
  return createProfilesService({
    repo: fake.repo,
    owner: "owner-1",
    catalog,
    seededProvider:
      opts.seededProvider === undefined ? shared : opts.seededProvider,
  });
}

async function refusal(run: () => Promise<unknown>): Promise<TRPCError> {
  const err = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TRPCError);
  return err as TRPCError;
}

describe("profiles service — the seeded Default", () => {
  it("asks the repository to seed the shared CurveBender profile on every list", async () => {
    const fake = fakeRepo({ rows: [row()], seeded: row() });
    await service(fake).list();
    expect(fake.calls.seeds).toEqual([
      {
        name: "Default",
        harness: "claude-code",
        providerTemplate: "curve-bender-deployment",
        model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
        settings: {},
      },
    ]);
  });

  it("writes the marker without a profile when the deployment has no shared provider", async () => {
    const fake = fakeRepo({ rows: [] });
    await service(fake, { seededProvider: null }).list();
    expect(fake.calls.seeds).toEqual([null]);
    expect(fake.calls.inserts).toEqual([]);
  });

  it("keeps the seeded profile recognisable after a rename", async () => {
    const fake = fakeRepo({
      rows: [row({ name: "Cheap and fast" })],
      seeded: row(),
    });
    const [listed] = await service(fake).list();
    expect(listed).toMatchObject({ name: "Cheap and fast", seeded: true });
  });

  it("does not seed from the delete path, so a deleted Default stays gone", async () => {
    const fake = fakeRepo({ seeded: null });
    await service(fake).delete("profile-1");
    expect(fake.calls.seeds).toEqual([]);
  });
});

describe("profiles service — list and usage", () => {
  it("reports the references each profile has", async () => {
    const fake = fakeRepo({
      rows: [row({ id: "p1" }), row({ id: "p2", name: "Review", seed: null })],
      counts: new Map([
        ["p1", { agents: 2, channels: 1, schedules: 3 }],
        ["p2", { agents: 0, channels: 0, schedules: 0 }],
      ]),
    });
    const listed = await service(fake).list();
    expect(listed.map((p) => [p.name, p.usage])).toEqual([
      ["Default", { agents: 2, channels: 1, schedules: 3 }],
      ["Review", { agents: 0, channels: 0, schedules: 0 }],
    ]);
  });

  it("refuses to delete a profile that something points at, naming what stops", async () => {
    const fake = fakeRepo({
      deleteOutcome: {
        outcome: "in-use",
        usage: {
          agents: [{ id: "agent-1", slots: ["chat"] }],
          channels: [{ agentId: "agent-1", label: "C0123" }],
          schedules: [
            { id: "sched-1", name: "Nightly", agentId: "agent-1" },
            { id: "sched-2", name: "Weekly", agentId: "agent-1" },
          ],
        },
      },
    });
    const err = await refusal(() => service(fake).delete("profile-1"));
    expect(err.code).toBe("PRECONDITION_FAILED");
    expect(err.message).toBe(
      "that profile is in use by 1 agent, 1 channel, 2 schedules",
    );
    expect(fake.calls.deleted).toEqual(["profile-1"]);
  });

  it("refuses a delete of a profile this owner does not have", async () => {
    const fake = fakeRepo({ deleteOutcome: { outcome: "missing" } });
    const err = await refusal(() => service(fake).delete("profile-x"));
    expect(err.code).toBe("NOT_FOUND");
  });
});

describe("profiles service — validation", () => {
  const valid = {
    name: "Review",
    harness: "claude-code",
    providerTemplate: "curve-bender-deployment",
    model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  };

  it("accepts a harness, provider and model that agree", async () => {
    const fake = fakeRepo({ rows: [] });
    const created = await service(fake).create(valid);
    expect(created.name).toBe("Review");
    expect(fake.calls.inserts).toEqual([{ ...valid, settings: {} }]);
  });

  it("refuses a harness the catalog does not offer", async () => {
    const fake = fakeRepo({ rows: [] });
    const err = await refusal(() =>
      service(fake).create({ ...valid, harness: "unknown" }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("unknown harness unknown");
  });

  it("refuses a provider that is not a preset", async () => {
    const fake = fakeRepo({ rows: [] });
    const err = await refusal(() =>
      service(fake).create({ ...valid, providerTemplate: "shared-kb" }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("unknown provider shared-kb");
  });

  it("refuses a bare model name", async () => {
    const fake = fakeRepo({ rows: [] });
    const err = await refusal(() =>
      service(fake).create({ ...valid, model: "gpt-6.1-sol" }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe(
      "name the model with its provider, as <provider>/gpt-6.1-sol",
    );
  });

  it("refuses a model whose provider is not the profile's", async () => {
    const fake = fakeRepo({ rows: [] });
    const err = await refusal(() =>
      service(fake).create({ ...valid, model: "openai/gpt-6.1-sol" }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe(
      "openai/gpt-6.1-sol is not a curve-bender-deployment model",
    );
  });

  it("refuses a harness that cannot run on the profile's provider", async () => {
    const fake = fakeRepo({ rows: [] });
    const err = await refusal(() =>
      service(fake).create({
        ...valid,
        harness: "bob",
        providerTemplate: "curve-bender-deployment",
      }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe(
      "the bob harness cannot run on curve-bender-deployment",
    );
  });

  it("re-checks the merged profile on an update, so a provider change cannot orphan the model", async () => {
    const fake = fakeRepo({ rows: [row()] });
    const err = await refusal(() =>
      service(fake).update({ id: "profile-1", providerTemplate: "openai" }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe(
      "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017 is not a openai model",
    );
    expect(fake.calls.updates).toEqual([]);
  });

  it("refuses an update to a profile this owner does not have", async () => {
    const fake = fakeRepo({ rows: [] });
    const err = await refusal(() =>
      service(fake).update({ id: "profile-x", name: "Other" }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });
});

describe("profiles service — binding a new agent's default", () => {
  it("binds the seeded profile when the agent's harness and provider fit", async () => {
    const fake = fakeRepo({ seeded: row() });
    await service(fake).bindDefaultAgentProfile({
      agentId: "agent-1",
      harness: "claude-code",
      grantedConnectionIds: ["conn-1"],
    });
    expect(fake.calls.binds).toEqual([
      { agentId: "agent-1", profileId: "profile-1" },
    ]);
  });

  it("binds nothing when the agent's harness is not the profile's", async () => {
    const fake = fakeRepo({ seeded: row() });
    await service(fake).bindDefaultAgentProfile({
      agentId: "agent-1",
      harness: "bob",
      grantedConnectionIds: ["conn-1"],
    });
    expect(fake.calls.binds).toEqual([]);
  });

  it("binds nothing when the agent was not granted the profile's provider", async () => {
    const fake = fakeRepo({ seeded: row(), holds: false });
    await service(fake).bindDefaultAgentProfile({
      agentId: "agent-1",
      harness: "claude-code",
      grantedConnectionIds: ["conn-1"],
    });
    expect(fake.calls.binds).toEqual([]);
  });

  it("binds nothing when no profile was seeded", async () => {
    const fake = fakeRepo({ seeded: null });
    await service(fake).bindDefaultAgentProfile({
      agentId: "agent-1",
      harness: "claude-code",
      grantedConnectionIds: ["conn-1"],
    });
    expect(fake.calls.binds).toEqual([]);
  });
});
