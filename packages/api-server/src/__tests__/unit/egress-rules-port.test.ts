import { describe, it, expect } from "vitest";
import { createEgressRulesService } from "../../modules/egress-rules/services/egress-rules-service.js";
import { createEgressRuleWriter } from "../../modules/egress-rules/services/egress-rule-writer.js";
import { createConnectionRulesSync } from "../../modules/egress-rules/services/connection-rules-sync.js";
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

/** Stateful repository fake: `listForAgent` reflects inserts and revokes, so
 *  the reconverge path (which recomputes promoted hosts from active rules)
 *  can be exercised end-to-end. */
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
    listConnectionDerivedForAgent: async () => [],
    hasUserOwnedRuleForHost: async () => false,
    findMatch: async () => null,
    getActiveByTuple: async () => null,
    getById: async (id) => rows.find((r) => r.id === id) ?? null,
    revoke: async (id) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.status = "revoked";
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

/** Captures the last host set written per agent. */
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

    // Port-scoped rule → the L4 catch-all always dials 443, so the host
    // must be promoted or the port silently never takes effect.
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

    // The only rule that pinned the host to L7 is gone — reconverge clears
    // it so the gateway stops MITM-terminating a host no rule needs (#2865).
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
    // The front door allows host "*" with a narrow method/path, but no
    // single SNI chain terminates every host and the CRD rejects "*" in
    // spec.l7Hosts — projecting it would make every reconverge (and the
    // startup backfill) fail permanently. Such a rule stays enforced at
    // host granularity on the L4 path, as it always has.
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

    // The connection host is covered by its own credential chain, so only
    // the manual narrow rule's host is promoted.
    expect(l7.last()).toEqual({ agentId: "a1", hosts: ["api.example.com"] });
  });
});

describe("connection-rules-sync: threads port into the inserted rule", () => {
  it("passes the connection host's port through to the repository", async () => {
    const { repo, rows } = fakeRepo();
    const sync = createConnectionRulesSync({ repo });

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
