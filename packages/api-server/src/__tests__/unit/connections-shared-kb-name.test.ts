import { describe, expect, it } from "vitest";
import type { Connection } from "api-server-api";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";
import { createOAuthEngine } from "../../modules/connections/infrastructure/oauth-engine.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import type { OAuthFlowService } from "../../modules/connections/services/oauth-flow.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";

/**
 * TEST_OVERVIEW: the consumer side of a shared knowledge base outliving its
 * share — the owner's public name is only readable while the share resolves,
 * so it is remembered on the connection and still shown once the share is
 * revoked, beside the expired status that explains why it stopped working.
 */

const OWNER = "owner-sub";
const SHARE_ID = "831359c58153";
const SECRET = "s".repeat(43);
const SHARE_STRING = `kbshare_${SHARE_ID}_${SECRET}`;
const SLUG = `kb-${SHARE_ID}`;

function makeRepoFake() {
  const rows = new Map<string, Connection>();
  const repo: ConnectionsRepository = {
    insert: async (input) => {
      rows.set(input.id, { ...input });
    },
    listByOwner: async (ownerId) =>
      [...rows.values()].filter((c) => c.ownerId === ownerId),
    get: async (id, ownerId) => {
      const c = rows.get(id);
      return c && c.ownerId === ownerId ? c : null;
    },
    updateAuth: async (id, auth) => {
      const c = rows.get(id);
      if (c) rows.set(id, { ...c, auth });
    },
    updateInputs: async (id, inputs) => {
      const c = rows.get(id);
      if (c) rows.set(id, { ...c, inputs });
    },
    updateContributions: async () => {},
    delete: async (id) => {
      rows.delete(id);
    },
    grant: async () => {},
    revoke: async () => {},
    listAgentGrants: async () => [],
    listConnectionsForAgent: async () => [],
    listAgentsForConnection: async () => [],
    revokeAllForAgent: async () => {},
    listDistinctGrantAgentIds: async () => [],
  };
  return { repo, rows };
}

function makeSecretStoreFake(): SecretStore {
  const stored = new Map<string, Record<string, string>>();
  return {
    storeId: "test",
    mintRef: (meta) => ({
      storeId: "test",
      path: `secret-${meta.purpose}`,
      field: "",
    }),
    put: async (ref, fields) => {
      stored.set(ref.path, { ...fields });
    },
    putField: async () => {},
    putFields: async (ref, fields) => {
      stored.set(ref.path, { ...(stored.get(ref.path) ?? {}), ...fields });
    },
    get: async (ref) => stored.get(ref.path) ?? null,
    getField: async (ref) => stored.get(ref.path)?.[ref.field] ?? null,
    delete: async (ref) => {
      stored.delete(ref.path);
    },
    list: async () => [],
  };
}

function makeService(
  share: { name: string | null; reachable?: boolean } | null,
) {
  const { repo, rows } = makeRepoFake();
  const state = { share };
  const oauthFlow: OAuthFlowService = {
    startOAuth: async () => {
      throw new Error("not used");
    },
    completeOAuth: async () => {
      throw new Error("not used");
    },
  };
  const svc = createConnectionsService({
    ownerId: OWNER,
    templates: createConnectionTemplateRegistry(buildCatalog()),
    repo,
    secretStore: makeSecretStoreFake(),
    fanOut: { apply: async () => {} },
    oauthFlow,
    oauthEngine: createOAuthEngine({
      pendingStore: createMemoryTtlStore(600_000),
    }),
    githubAppEngine: createGitHubAppEngine(),
    oauthCallbackUrl: "https://cb.example/oauth/callback",
    brandName: "Test",
    connectionLock: (_key, fn) => fn(),
    verifyKbShare: async () => state.share !== null,
    resolveKbShare: async () =>
      state.share === null
        ? null
        : { name: state.share.name, reachable: state.share.reachable ?? true },
  });
  return { svc, rows, state };
}

async function connect(svc: ReturnType<typeof makeService>["svc"]) {
  return svc.createFromTemplate({
    templateId: "shared-knowledge-base",
    name: SLUG,
    authKind: "header",
    value: SHARE_STRING,
  });
}

describe("shared knowledge base connection naming", () => {
  // TEST_SCENARIO: while the share resolves, the consumer sees the owner's public name rather than the internal per-share slug the connection is stored under.
  it("shows the owner's public name for a live share", async () => {
    const { svc } = makeService({ name: "Team Wiki" });
    await connect(svc);
    const [view] = await svc.listConnections();
    expect(view?.name).toBe("Team Wiki");
    expect(view?.status).not.toBe("expired");
  });

  // TEST_SCENARIO: the name is remembered on the connection, so revoking the share leaves a row that still says which knowledge base it was, marked expired.
  it("keeps the last known name after the share is revoked", async () => {
    const { svc, state } = makeService({ name: "Team Wiki" });
    await connect(svc);
    await svc.listConnections();

    state.share = null;
    const [view] = await svc.listConnections();
    expect(view?.name).toBe("Team Wiki");
    expect(view?.status).toBe("expired");
  });

  // TEST_SCENARIO: a rename by the owner replaces the remembered name on the next successful resolve, so the consumer never keeps a stale one.
  it("refreshes the remembered name when the owner renames the share", async () => {
    const { svc, state } = makeService({ name: "Team Wiki" });
    await connect(svc);
    await svc.listConnections();

    state.share = { name: "Platform Wiki" };
    await svc.listConnections();
    state.share = null;
    const [view] = await svc.listConnections();
    expect(view?.name).toBe("Platform Wiki");
  });

  // TEST_SCENARIO: an unshared knowledge base is unrecoverable — its id is retired, so re-sharing mints a new one and the old entry can only be removed, never reconnected.
  it("marks an unshared knowledge base unrecoverable", async () => {
    const { svc, state } = makeService({ name: "Team Wiki" });
    await connect(svc);
    await svc.listConnections();

    state.share = null;
    const [view] = await svc.listConnections();
    expect(view?.unrecoverable).toBe(true);
  });

  // TEST_SCENARIO: a merely rotated link stays recoverable — the share still exists, so pasting the owner's current link repairs this same entry.
  it("leaves a rotated link recoverable", async () => {
    const { svc, state } = makeService({ name: "Team Wiki" });
    await connect(svc);

    state.share = { name: "Team Wiki", reachable: false };
    const [view] = await svc.listConnections();
    expect(view?.status).toBe("expired");
    expect(view?.unrecoverable).toBeUndefined();
  });

  // TEST_SCENARIO: a share that never resolved (no name was ever seen) falls back to the stored slug instead of rendering an empty name.
  it("falls back to the stored slug when no name was ever resolved", async () => {
    const { svc, state } = makeService({ name: null });
    await connect(svc);
    state.share = null;
    const [view] = await svc.listConnections();
    expect(view?.name).toBe(SLUG);
    expect(view?.status).toBe("expired");
  });
});
