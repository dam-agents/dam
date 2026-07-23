import { describe, it, expect } from "vitest";
import { createAgentL7HostsPort } from "../../modules/egress-rules/infrastructure/k8s-agent-l7-hosts-port.js";
import { backfillL7Promotions } from "../../modules/egress-rules/services/l7-promotion-backfill.js";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";
import type { EgressRulesRepository } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";

/** Minimal K8s fake: Agent CRs keyed by name + legacy marker Secrets.
 *  The patch response echoes the stored object, like the real API server;
 *  `pruneWrites` simulates a live CRD older than Agent schema gen 5, whose
 *  structural schema drops the unknown field and still returns 200. */
function fakeK8s(opts: {
  agents: Record<string, { l7Hosts?: string[] }>;
  markers?: string[];
  failPatchFor?: string;
  pruneWrites?: boolean;
}) {
  const patches: Array<{ name: string; l7Hosts: string[] }> = [];
  const deleted: string[] = [];
  const client = {
    getCustomObject: async (_plural: string, name: string) =>
      name in opts.agents
        ? ({
            metadata: { name, resourceVersion: "1" },
            spec: opts.agents[name],
          } as KubeObject)
        : null,
    patchCustomObject: async (_plural: string, name: string, body: object) => {
      if (name === opts.failPatchFor) throw new Error("boom");
      if (opts.pruneWrites) {
        return { metadata: { name }, spec: opts.agents[name] } as KubeObject;
      }
      const spec = (body as { spec: { l7Hosts: string[] } }).spec;
      patches.push({ name, l7Hosts: spec.l7Hosts });
      opts.agents[name] = { l7Hosts: spec.l7Hosts };
      return { metadata: { name }, spec: opts.agents[name] } as KubeObject;
    },
    listSecrets: async () =>
      (opts.markers ?? []).map((name) => ({ metadata: { name } })),
    deleteSecret: async (name: string) => {
      deleted.push(name);
    },
  } as unknown as K8sClient;
  return { client, patches, deleted };
}

function fakeRepo(
  rules: Array<{
    agentId: string;
    host: string;
    method: string;
    pathPattern: string;
    port?: number;
    source?: string;
  }>,
): EgressRulesRepository {
  return {
    listActiveForPromotionScan: async () =>
      rules.map((r) => ({ source: "manual", ...r })),
  } as unknown as EgressRulesRepository;
}

describe("agent-l7-hosts port", () => {
  it("replaces spec.l7Hosts with exactly the given set, sorted", async () => {
    const { client, patches } = fakeK8s({
      agents: { a1: { l7Hosts: ["old.example.com"] } },
    });
    const port = createAgentL7HostsPort(client);

    // set REPLACES (it is the demotion path too): the stale host is gone.
    await port.set("a1", ["b.example.com", "a.example.com"]);
    expect(patches).toEqual([
      { name: "a1", l7Hosts: ["a.example.com", "b.example.com"] },
    ]);

    // Same set again → no patch, so an unchanged reconverge never rolls.
    await port.set("a1", ["a.example.com", "b.example.com"]);
    expect(patches).toHaveLength(1);
  });

  it("no-ops for a missing Agent CR (rules can outlive the agent)", async () => {
    const { client, patches } = fakeK8s({ agents: {} });
    await createAgentL7HostsPort(client).set("gone", ["a.example.com"]);
    expect(patches).toHaveLength(0);
  });

  it("throws when the write is silently pruned (pre-gen-5 live CRD)", async () => {
    // A structural schema without l7Hosts drops the field and returns
    // 200 — the port must not report success, or the backfill would
    // delete the legacy markers and silently unenforce every narrow
    // rule (#2322 class).
    const { client } = fakeK8s({ agents: { a1: {} }, pruneWrites: true });
    await expect(
      createAgentL7HostsPort(client).set("a1", ["a.example.com"]),
    ).rejects.toThrow(/did not persist/);
  });
});

describe("l7-promotion backfill (#2865)", () => {
  it("projects active narrow rules per agent, then retires legacy markers", async () => {
    const { client, patches, deleted } = fakeK8s({
      agents: { a1: {}, a2: {} },
      markers: ["platform-allow-x", "platform-allow-y"],
    });
    const { failed } = await backfillL7Promotions({
      repo: fakeRepo([
        // narrow → promoted, keyed by the rule's agent
        {
          agentId: "a1",
          host: "api.github.com",
          method: "GET",
          pathPattern: "/repos/*",
        },
        // host-wide 443 → stays on the L4 path
        { agentId: "a2", host: "example.com", method: "*", pathPattern: "*" },
        // port-scoped → promoted
        {
          agentId: "a2",
          host: "api.cluster.example",
          method: "*",
          pathPattern: "*",
          port: 6443,
        },
      ]),
      l7Hosts: createAgentL7HostsPort(client),
      k8sClient: client,
      log: () => {},
    });

    expect(failed).toBe(0);
    expect(patches).toEqual([
      { name: "a1", l7Hosts: ["api.github.com"] },
      { name: "a2", l7Hosts: ["api.cluster.example"] },
    ]);
    expect(deleted).toEqual(["platform-allow-x", "platform-allow-y"]);
  });

  it("never projects the bare * host (CRD would reject the whole patch)", async () => {
    const { client, patches, deleted } = fakeK8s({
      agents: { a1: {} },
      markers: ["platform-allow-x"],
    });
    const { failed } = await backfillL7Promotions({
      repo: fakeRepo([
        // A narrowing on "*" must not fail the backfill forever — it is
        // simply not projectable and stays host-granular on L4.
        { agentId: "a1", host: "*", method: "GET", pathPattern: "/x" },
        {
          agentId: "a1",
          host: "api.github.com",
          method: "GET",
          pathPattern: "/repos/*",
        },
      ]),
      l7Hosts: createAgentL7HostsPort(client),
      k8sClient: client,
      log: () => {},
    });

    expect(failed).toBe(0);
    expect(patches).toEqual([{ name: "a1", l7Hosts: ["api.github.com"] }]);
    expect(deleted).toEqual(["platform-allow-x"]);
  });

  it("excludes connection-derived rules (covered by their own credential chain)", async () => {
    const { client, patches, deleted } = fakeK8s({
      agents: { a1: {} },
      markers: [],
    });
    const { failed } = await backfillL7Promotions({
      repo: fakeRepo([
        {
          agentId: "a1",
          host: "api.cluster.example",
          method: "*",
          pathPattern: "*",
          port: 6443,
          source: "connection:conn-1",
        },
        {
          agentId: "a1",
          host: "api.github.com",
          method: "GET",
          pathPattern: "/repos/*",
          source: "manual",
        },
      ]),
      l7Hosts: createAgentL7HostsPort(client),
      k8sClient: client,
      log: () => {},
    });

    expect(failed).toBe(0);
    expect(patches).toEqual([{ name: "a1", l7Hosts: ["api.github.com"] }]);
    expect(deleted).toEqual([]);
  });

  it("keeps legacy markers when writes are pruned by an old live CRD", async () => {
    const { client, deleted } = fakeK8s({
      agents: { a1: {} },
      markers: ["platform-allow-x"],
      pruneWrites: true,
    });
    const { failed } = await backfillL7Promotions({
      repo: fakeRepo([
        {
          agentId: "a1",
          host: "api.github.com",
          method: "GET",
          pathPattern: "/repos/*",
        },
      ]),
      l7Hosts: createAgentL7HostsPort(client),
      k8sClient: client,
      log: () => {},
    });

    expect(failed).toBe(1);
    expect(deleted).toHaveLength(0);
  });

  it("keeps legacy markers when any agent patch fails (rules stay enforced)", async () => {
    const { client, deleted } = fakeK8s({
      agents: { a1: {}, a2: {} },
      markers: ["platform-allow-x"],
      failPatchFor: "a2",
    });
    const { failed } = await backfillL7Promotions({
      repo: fakeRepo([
        {
          agentId: "a1",
          host: "api.github.com",
          method: "GET",
          pathPattern: "/repos/*",
        },
        {
          agentId: "a2",
          host: "api.other.com",
          method: "POST",
          pathPattern: "*",
        },
      ]),
      l7Hosts: createAgentL7HostsPort(client),
      k8sClient: client,
      log: () => {},
    });

    expect(failed).toBe(1);
    expect(deleted).toHaveLength(0);
  });
});
