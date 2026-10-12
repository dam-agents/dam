import { describe, expect, it } from "vitest";
import type { Connection } from "api-server-api";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import { configureLogger } from "../../core/logger.js";

/**
 * TEST_OVERVIEW: a provider connection's settings (the Bob pins) change in
 * place without re-entering its key. The stored key stays as it is, the new
 * settings replace the old ones, and the agents that use the connection pick
 * them up.
 */

configureLogger({ level: "error", write: () => {} });

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

function makeService() {
  const rows = new Map<string, Connection>();
  const secretWrites: string[] = [];
  const probed: string[] = [];
  const fannedOut: string[] = [];
  const svc = createConnectionsService({
    ownerId: "owner",
    templates: createConnectionTemplateRegistry(buildCatalog()),
    repo: unused<ConnectionsRepository>({
      insert: async (c) => void rows.set(c.id, c),
      get: async (id) => rows.get(id) ?? null,
      mergeInputs: async (id, patch) => {
        const row = rows.get(id)!;
        rows.set(id, { ...row, inputs: { ...row.inputs, ...patch } });
      },
      updateContributions: async (id, contributions) => {
        rows.set(id, { ...rows.get(id)!, contributions });
      },
      listByOwner: async () => [...rows.values()],
      listAgentsForConnection: async () => ["agent-1"],
      listConnectionsForAgent: async () => [...rows.values()],
    }),
    secretStore: unused<SecretStore>({
      storeId: "test",
      mintRef: (meta) => ({ storeId: "test", path: meta.purpose, field: "" }),
      put: async (ref) => void secretWrites.push(ref.path),
      putFields: async (ref) => void secretWrites.push(ref.path),
    }),
    fanOut: {
      apply: async ({ agentId }) => void fannedOut.push(agentId),
    },
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    s3CredentialProbe: unused(),
    providerBalance: unused(),
    providerKeyProbe: {
      probe: async (templateId, key) => {
        probed.push(`${templateId}:${key}`);
        return { ok: true };
      },
    },
    oauthCallbackUrl: "https://example.com/callback",
    brandName: "Test",
    connectionLock: (_key, fn) => fn(),
    isOwnedAgent: async () => true,
    resolveKbShare: unused(),
  });
  return { svc, rows, secretWrites, probed, fannedOut };
}

function envOf(conn: Connection): Record<string, string> {
  return Object.fromEntries(
    conn.contributions.flatMap((c) =>
      c.kind === "env" ? [[c.name, c.placeholder]] : [],
    ),
  );
}

async function bobConnection(svc: ReturnType<typeof makeService>["svc"]) {
  return svc.createFromTemplate({
    templateId: "bob",
    name: "bob",
    authKind: "header",
    value: "bob-key",
    configInputs: { model: "premium-shell", teamId: "team-1" },
  });
}

describe("connection settings update", () => {
  // TEST_SCENARIO: changing the Bob pins alone keeps the stored key, replaces the pins, and re-applies the connection to its agents.
  it("changes the pins without re-entering the key", async () => {
    const { svc, rows, secretWrites, probed, fannedOut } = makeService();
    const id = await bobConnection(svc);
    secretWrites.length = 0;
    probed.length = 0;

    await svc.update(id, { configInputs: { teamId: "team-2", maxCost: "5" } });

    const env = envOf(rows.get(id)!);
    expect(env).toMatchObject({ BOB_TEAM_ID: "team-2", BOB_MAX_COINS: "5" });
    expect(env).not.toHaveProperty("BOB_SHELL_MODEL");
    expect(env).toHaveProperty("BOBSHELL_API_KEY");
    expect(rows.get(id)!.inputs).toMatchObject({
      configInputs: { teamId: "team-2", maxCost: "5" },
    });
    expect(secretWrites).toEqual([]);
    expect(probed).toEqual([]);
    expect(fannedOut).toEqual(["agent-1"]);
  });

  // TEST_SCENARIO: a pin that fails its template rule is refused before the new key is stored.
  it("refuses an invalid pin before rotating the key", async () => {
    const { svc, rows, secretWrites } = makeService();
    const id = await bobConnection(svc);
    secretWrites.length = 0;
    const before = rows.get(id);

    await expect(
      svc.update(id, { value: "new-key", configInputs: { maxCost: "-1" } }),
    ).rejects.toThrow(/Max cost/);
    expect(secretWrites).toEqual([]);
    expect(rows.get(id)).toBe(before);
  });
});
