import { describe, it, expect } from "vitest";
import { createEgressRulesService } from "../../modules/egress-rules/services/egress-rules-service.js";
import { createEgressRuleWriter } from "../../modules/egress-rules/services/egress-rule-writer.js";
import { createConnectionRulesSync } from "../../modules/egress-rules/services/connection-rules-sync.js";
import { createKitRulesSeeder } from "../../modules/egress-rules/services/kit-rules-seeder.js";
import { createPresetSeeder } from "../../modules/egress-rules/services/preset-seeder.js";
import type { EgressRulesRepository } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";
import type { NewEgressRule } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";
import type { EgressRuleRow } from "../../modules/egress-rules/domain/types.js";
import type { AgentL7HostsPort } from "../../modules/egress-rules/infrastructure/k8s-agent-l7-hosts-port.js";

function rowFrom(r: NewEgressRule): EgressRuleRow {
  return {
    id: r.id,
    agentId: r.agentId,
    host: r.host,
    ...(r.port ? { port: r.port } : {}),
    method: r.method,
    pathPattern: r.pathPattern,
    verdict: r.verdict,
    decidedBy: r.decidedBy,
    decidedAt: new Date(0),
    status: "active",
    source: r.source,
  };
}

function fakeRepo(
  seed: EgressRuleRow[] = [],
  overrides: Partial<EgressRulesRepository> = {},
) {
  const rows = [...seed];
  const base: EgressRulesRepository = {
    insert: async (row) => {
      const r = rowFrom(row);
      rows.push(r);
      return r;
    },
    insertOrPromoteFromPreset: async (row) => {
      const r = rowFrom(row);
      rows.push(r);
      return r;
    },
    insertAll: async (all) => {
      rows.push(...all.map(rowFrom));
    },
    listConnectionDerivedForAgent: async () => [],
    hasUserOwnedRuleForHost: async () => false,
    findMatch: async () => null,
    getActiveByTuple: async () => null,
    getById: async (id) => rows.find((r) => r.id === id) ?? null,
    revoke: async (id) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.status = "revoked";
    },
    setSource: async (id, source) => {
      const r = rows.find((x) => x.id === id && x.status === "active");
      if (r) r.source = source;
    },
    updateTakeOwnership: async () => null,
    listForAgent: async (agentId) =>
      rows.filter((r) => r.agentId === agentId && r.status === "active"),
    reassignActiveSource: async () => {},
    revokePresetRowsForAgent: async () => {},
    getPresetForAgent: async () => "none",
    listDistinctAgentIds: async () => [],
    deleteAllForAgent: async () => {},
    ...overrides,
  } as EgressRulesRepository;
  return { repo: base, rows };
}

function fakeL7Hosts() {
  const sets: Array<{ agentId: string; hosts: readonly string[] }> = [];
  const port: AgentL7HostsPort = {
    set: async (agentId, hosts) => {
      sets.push({ agentId, hosts });
    },
  };
  return { port, sets, last: () => sets[sets.length - 1] };
}

describe("egress-rules-service: reconverge projects the rule table onto spec.l7Hosts", () => {
  it("promotes a narrow rule's host on create", async () => {
    const { repo } = fakeRepo();
    const l7 = fakeL7Hosts();
    const svc = createEgressRulesService({
      repo,
      l7Hosts: l7.port,
      trustedHosts: [],
      isAgentOwnedBy: async () => true,
      ownerSub: "sub-1",
    });

    await svc.create({
      agentId: "a1",
      host: "api.cluster.example",
      port: 6443,
      method: "*",
      pathPattern: "*",
      verdict: "allow",
    });

    expect(l7.last()).toEqual({
      agentId: "a1",
      hosts: ["api.cluster.example"],
    });
  });

  it("does NOT promote a plain host-only 443 rule (stays on the L4 path)", async () => {
    const { repo } = fakeRepo();
    const l7 = fakeL7Hosts();
    const svc = createEgressRulesService({
      repo,
      l7Hosts: l7.port,
      trustedHosts: [],
      isAgentOwnedBy: async () => true,
      ownerSub: "sub-1",
    });

    await svc.create({
      agentId: "a1",
      host: "api.example.com",
      method: "*",
      pathPattern: "*",
      verdict: "allow",
    });

    expect(l7.last()).toEqual({ agentId: "a1", hosts: [] });
  });

  it("demotes the host when the last narrowing on it is revoked", async () => {
    const seed = [
      rowFrom({
        id: "r1",
        agentId: "a1",
        host: "api.example.com",
        method: "GET",
        pathPattern: "/status/*",
        verdict: "allow",
        decidedBy: "sub-1",
        source: "manual",
      }),
    ];
    const { repo } = fakeRepo(seed);
    const l7 = fakeL7Hosts();
    const svc = createEgressRulesService({
      repo,
      l7Hosts: l7.port,
      trustedHosts: [],
      isAgentOwnedBy: async () => true,
      ownerSub: "sub-1",
    });

    await svc.revoke("r1");

    expect(l7.last()).toEqual({ agentId: "a1", hosts: [] });
  });

  it("keeps the host promoted while another narrowing on it survives", async () => {
    const seed = [
      rowFrom({
        id: "r1",
        agentId: "a1",
        host: "api.example.com",
        method: "GET",
        pathPattern: "/a/*",
        verdict: "allow",
        decidedBy: "sub-1",
        source: "manual",
      }),
      rowFrom({
        id: "r2",
        agentId: "a1",
        host: "api.example.com",
        method: "POST",
        pathPattern: "/b/*",
        verdict: "allow",
        decidedBy: "sub-1",
        source: "manual",
      }),
    ];
    const { repo } = fakeRepo(seed);
    const l7 = fakeL7Hosts();
    const svc = createEgressRulesService({
      repo,
      l7Hosts: l7.port,
      trustedHosts: [],
      isAgentOwnedBy: async () => true,
      ownerSub: "sub-1",
    });

    await svc.revoke("r1");

    expect(l7.last()).toEqual({ agentId: "a1", hosts: ["api.example.com"] });
  });
});

describe("egress-rule-writer: inbox verdicts reconverge the same way (#2322)", () => {
  it("promotes a narrow rule's host, projected from the agent's active rules", async () => {
    const { repo, rows } = fakeRepo();
    const l7 = fakeL7Hosts();
    const writer = createEgressRuleWriter({ repo, l7Hosts: l7.port });

    await writer.insert({
      id: "r1",
      agentId: "a1",
      host: "api.example.com",
      method: "GET",
      pathPattern: "/status/*",
      verdict: "allow",
      decidedBy: "agent-owner",
      source: "inbox",
    });

    expect(rows).toHaveLength(1);
    expect(l7.last()).toEqual({ agentId: "a1", hosts: ["api.example.com"] });
  });

  it("does NOT promote a host-wide rule (stays on the L4 path)", async () => {
    const { repo } = fakeRepo();
    const l7 = fakeL7Hosts();
    const writer = createEgressRuleWriter({ repo, l7Hosts: l7.port });

    await writer.insert({
      id: "r1",
      agentId: "a1",
      host: "api.example.com",
      method: "*",
      pathPattern: "*",
      verdict: "allow",
      decidedBy: "agent-owner",
      source: "inbox",
    });

    expect(l7.last()).toEqual({ agentId: "a1", hosts: [] });
  });

  it("never promotes the bare * host, even for a narrowing rule", async () => {
    const { repo } = fakeRepo();
    const l7 = fakeL7Hosts();
    const writer = createEgressRuleWriter({ repo, l7Hosts: l7.port });

    await writer.insert({
      id: "r1",
      agentId: "a1",
      host: "*",
      method: "GET",
      pathPattern: "/x",
      verdict: "allow",
      decidedBy: "sub-1",
      source: "inbox",
    });

    expect(l7.last()).toEqual({ agentId: "a1", hosts: [] });
  });

  it("excludes connection-derived rules (already TLS-terminated by their credential)", async () => {
    const seed = [
      rowFrom({
        id: "c1",
        agentId: "a1",
        host: "api.cluster.example",
        port: 6443,
        method: "*",
        pathPattern: "*",
        verdict: "allow",
        decidedBy: "sub-1",
        source: "connection:conn-1",
      }),
    ];
    const { repo } = fakeRepo(seed);
    const l7 = fakeL7Hosts();
    const writer = createEgressRuleWriter({ repo, l7Hosts: l7.port });

    await writer.insert({
      id: "m1",
      agentId: "a1",
      host: "api.example.com",
      method: "GET",
      pathPattern: "/x",
      verdict: "allow",
      decidedBy: "sub-1",
      source: "manual",
    });

    expect(l7.last()).toEqual({ agentId: "a1", hosts: ["api.example.com"] });
  });
});

describe("connection-rules-sync: threads port into the inserted rule", () => {
  it("passes the connection host's port through to the repository", async () => {
    const { repo, rows } = fakeRepo();
    const sync = createConnectionRulesSync({ repo, trustedHosts: [] });

    await sync.syncForAgent({
      agentId: "a1",
      decidedBy: "sub-1",
      grants: new Map([
        ["conn-1", { hosts: [{ host: "api.cluster.example", port: 6443 }] }],
      ]),
      ownedSourceIds: new Set(["conn-1"]),
    });

    const inserted = rows.find((r) => r.host === "api.cluster.example");
    expect(inserted).toMatchObject({
      host: "api.cluster.example",
      port: 6443,
      source: "connection:conn-1",
    });
  });
});

describe("connection-rules-sync: a revoked Connection hands a trusted host back to the preset", () => {
  const anthropicRow = (source: EgressRuleRow["source"]): EgressRuleRow => ({
    id: "r1",
    agentId: "a1",
    host: "api.anthropic.com",
    method: "*",
    pathPattern: "*",
    verdict: "allow",
    decidedBy: "sub-1",
    decidedAt: new Date(0),
    status: "active",
    source,
  });

  const revokeConn1 = async (preset: "trusted" | "none") => {
    const seeded = anthropicRow("connection:conn-1");
    const { repo, rows } = fakeRepo([seeded], {
      listConnectionDerivedForAgent: async () => [seeded],
      getPresetForAgent: async () => preset,
    });
    await createConnectionRulesSync({
      repo,
      trustedHosts: ["api.anthropic.com"],
    }).syncForAgent({
      agentId: "a1",
      decidedBy: "sub-1",
      grants: new Map(),
      ownedSourceIds: new Set(["conn-1"]),
    });
    return rows;
  };

  // TEST_SCENARIO: the trusted preset seeds api.anthropic.com; granting an Anthropic Connection takes that row over, and revoking the Connection (a switch to LiteLLM) used to revoke it, so Claude Code's own calls to the host raised an approval nobody expected. The row must go back to the preset.
  it("keeps a trusted host's row as a preset row on an agent with the trusted preset", async () => {
    const rows = await revokeConn1("trusted");

    expect(rows).toEqual([
      expect.objectContaining({ status: "active", source: "preset:trusted" }),
    ]);
  });

  it("revokes the row on an agent without the trusted preset", async () => {
    const rows = await revokeConn1("none");

    expect(rows).toEqual([expect.objectContaining({ status: "revoked" })]);
  });
});

describe("kit-rules-seeder: a kit rule never silently loses to a preset row", () => {
  // TEST_SCENARIO: a kit that denies a host its preset already allows would otherwise leave the allow in place without a word; the seeder must refuse so apply can undo the create.
  it("refuses a kit rule whose verdict clashes with the row already there", async () => {
    const { repo } = fakeRepo([], {
      insertOrPromoteFromPreset: async (row) => ({
        ...rowFrom(row),
        verdict: "allow",
        source: "kit",
      }),
    });
    const seeder = createKitRulesSeeder({ repo, l7Hosts: fakeL7Hosts().port });

    await expect(
      seeder.seed(
        "a1",
        [
          {
            host: "github.com",
            method: "*",
            pathPattern: "*",
            verdict: "deny",
          },
        ],
        "sub-1",
      ),
    ).rejects.toThrow(/clashes/);
  });
});

describe("preset-seeder: the trusted preset is one write", () => {
  // TEST_SCENARIO: an agent create seeds every trusted host; one round trip per host put ~0.5 s on the create, so the hosts go in as one batch after the old preset rows are revoked.
  it("revokes the old preset rows, then inserts every trusted host in one call", async () => {
    const calls: string[] = [];
    const { repo, rows } = fakeRepo([], {
      revokePresetRowsForAgent: async () => {
        calls.push("revoke");
      },
      insert: async () => {
        throw new Error("per-host insert");
      },
    });
    const batch = repo.insertAll;
    repo.insertAll = async (all) => {
      calls.push(`insertAll:${all.length}`);
      await batch(all);
    };
    const hosts = ["a.example", "b.example", "c.example"];
    await createPresetSeeder({ repo, trustedHosts: hosts }).seed(
      "agent-1",
      "trusted",
      "owner-1",
    );
    expect(calls).toEqual(["revoke", "insertAll:3"]);
    expect(rows.map((r) => [r.host, r.source])).toEqual(
      hosts.map((h) => [h, "preset:trusted"]),
    );
  });
});
