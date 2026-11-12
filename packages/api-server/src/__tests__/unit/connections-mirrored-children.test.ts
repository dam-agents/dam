// TEST_OVERVIEW: a child launched with its parent's connections holds the parent's whole grant set for as long as it lives: a grant or a revoke on the parent reaches the child, and through it the child's own mirroring children, while a child that copied a subset keeps what it had.
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "api-server-api";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";

type ConnectionsDeps = Parameters<typeof createConnectionsService>[0];

const OWNER = "owner-1";

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

function connection(id: string, templateId: string): Connection {
  const template = buildCatalog().find((t) => t.id === templateId);
  if (!template) throw new Error(`${templateId} missing from catalog`);
  return {
    id,
    ownerId: OWNER,
    templateId,
    name: id,
    inputs: {},
    auth: { kind: "none" },
    contributions: [...template.contributions],
  };
}

const github = connection("github", "github");
const slack = connection("slack", "slack");

function setup(mirrors: Record<string, string[]>) {
  const rows = [github, slack];
  const byId = new Map(rows.map((c) => [c.id, c]));
  const grants = new Map<string, Set<string>>();
  const held = (agentId: string) => {
    let set = grants.get(agentId);
    if (!set) grants.set(agentId, (set = new Set()));
    return set;
  };
  const service = createConnectionsService({
    damConnectionOffered: async () => true,
    harnesses: { default: "claude-code", harnesses: [] },
    isOwnedAgent: async () => true,
    ownerId: OWNER,
    repo: unused<ConnectionsDeps["repo"]>({
      listByOwner: async () => rows,
      get: async (id) => byId.get(id) ?? null,
      listAgentGrants: async (agentId) =>
        [...held(agentId)].map((connectionId) => ({
          connectionId,
          grantedAt: new Date(0),
          preferred: false,
        })),
      grant: async (connectionId, agentId) => {
        held(agentId).add(connectionId);
      },
      revoke: async (connectionId, agentId) => {
        held(agentId).delete(connectionId);
      },
    }),
    templates: unused(),
    secretStore: unused(),
    fanOut: { apply: vi.fn(async () => {}) },
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    s3CredentialProbe: unused(),
    providerBalance: unused(),
    credentialProbe: unused(),
    providerKeyProbe: unused(),
    oauthCallbackUrl: "https://example.com/callback",
    brandName: "Test",
    connectionLock: (_key, fn) => fn(),
    resolveKbShare: async () => null,
    mirroredChildren: async (agentId) => mirrors[agentId] ?? [],
  });
  return { service, held };
}

describe("children that mirror their parent's connections", () => {
  // TEST_SCENARIO: the parent gains a connection and loses one; its mirroring child and that child's mirroring child end with exactly the parent's set, so a revoked credential leaves the whole attached chain at once.
  it("follow every grant and revoke down the chain", async () => {
    const { service, held } = setup({
      parent: ["child"],
      child: ["grandchild"],
    });
    await service.setAgentConnections("parent", ["github"]);
    expect([...held("child")]).toEqual(["github"]);
    expect([...held("grandchild")]).toEqual(["github"]);

    await service.updateAgentConnections("parent", {
      grant: ["slack"],
      revoke: ["github"],
    });
    expect([...held("parent")]).toEqual(["slack"]);
    expect([...held("child")]).toEqual(["slack"]);
    expect([...held("grandchild")]).toEqual(["slack"]);
  });
});
