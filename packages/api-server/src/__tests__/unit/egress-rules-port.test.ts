import { describe, it, expect } from "vitest";
import { createEgressRulesService } from "../../modules/egress-rules/services/egress-rules-service.js";
import { createConnectionRulesSync } from "../../modules/egress-rules/services/connection-rules-sync.js";
import type { EgressRulesRepository } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";
import type { NewEgressRule } from "../../modules/egress-rules/infrastructure/egress-rules-repository.js";
import type { EgressRuleRow } from "../../modules/egress-rules/domain/types.js";

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

/** Repository fake capturing inserted rows. */
function fakeRepo(overrides: Partial<EgressRulesRepository> = {}) {
  const inserted: NewEgressRule[] = [];
  const base: EgressRulesRepository = {
    insert: async (row) => {
      inserted.push(row);
      return rowFrom(row);
    },
    insertOrPromoteFromPreset: async (row) => {
      inserted.push(row);
      return rowFrom(row);
    },
    listConnectionDerivedForAgent: async () => [],
    hasUserOwnedRuleForHost: async () => false,
    findMatch: async () => null,
    getById: async () => null,
    revoke: async () => {},
    updatePromoteToManual: async () => null,
    listForAgent: async () => [],
    reassignActiveSource: async () => {},
    revokePresetRowsForAgent: async () => {},
    getPresetForAgent: async () => "none",
    listDistinctAgentIds: async () => [],
    deleteAllForAgent: async () => {},
    ...overrides,
  } as EgressRulesRepository;
  return { repo: base, inserted };
}

describe("egress-rules-service: port promotes a manual rule onto the L7 chain", () => {
  it("calls allowOnlySecrets.ensure for a port-carrying wildcard rule", async () => {
    const { repo } = fakeRepo();
    const ensured: Array<{ owner: string; host: string }> = [];
    const svc = createEgressRulesService({
      repo,
      allowOnlySecrets: {
        ensure: async (owner, host) => {
          ensured.push({ owner, host });
        },
      },
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

    // Without promotion the rule falls to the L4 catch-all, which always
    // dials 443 — the port would silently never take effect.
    expect(ensured).toEqual([{ owner: "sub-1", host: "api.cluster.example" }]);
  });

  it("does NOT promote a plain host-only 443 rule (stays on the L4 path)", async () => {
    const { repo } = fakeRepo();
    let ensureCalls = 0;
    const svc = createEgressRulesService({
      repo,
      allowOnlySecrets: {
        ensure: async () => {
          ensureCalls++;
        },
      },
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

    expect(ensureCalls).toBe(0);
  });
});

describe("connection-rules-sync: threads port into the inserted rule", () => {
  it("passes the connection host's port through to the repository", async () => {
    const { repo, inserted } = fakeRepo();
    const sync = createConnectionRulesSync({ repo });

    await sync.syncForAgent({
      agentId: "a1",
      decidedBy: "sub-1",
      grants: new Map([
        ["conn-1", { hosts: [{ host: "api.cluster.example", port: 6443 }] }],
      ]),
      ownedSourceIds: new Set(["conn-1"]),
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      host: "api.cluster.example",
      port: 6443,
      source: "connection:conn-1",
    });
  });
});
