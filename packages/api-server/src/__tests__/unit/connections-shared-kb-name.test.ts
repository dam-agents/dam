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
 * TEST_OVERVIEW: the consumer side of a shared knowledge base outliving the
 * share link it was connected through — one entry per knowledge base, so
 * re-sharing re-points the row it already has instead of adding a second one,
 * and the owner's public name (readable only while a share resolves) is
 * remembered so a row that stopped working still says which knowledge base it
 * was, beside the expired status that explains it.
 */

const OWNER = "owner-sub";
const AGENT = "agent-wiki";
const SHARE_ID = "831359c58153";
const RESHARE_ID = "9f2c41ab7710";
const SECRET = "s".repeat(43);
const RESHARE_SECRET = "r".repeat(43);
const SHARE_STRING = `kbshare_${SHARE_ID}_${SECRET}`;
const RESHARE_STRING = `kbshare_${RESHARE_ID}_${RESHARE_SECRET}`;
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
  share: { name: string | null; reachable?: boolean; agentId?: string } | null,
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
        : {
            agentId: state.share.agentId ?? AGENT,
            name: state.share.name,
            reachable: state.share.reachable ?? true,
          },
  });
  return { svc, rows, state };
}

async function connect(
  svc: ReturnType<typeof makeService>["svc"],
  value = SHARE_STRING,
) {
  return svc.createFromTemplate({
    templateId: "shared-knowledge-base",
    name: `kb-${value.slice(8, 20)}`,
    authKind: "header",
    value,
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

  // TEST_SCENARIO: unsharing and re-sharing mints a new share id for the same knowledge base — connecting the new link re-points the existing row rather than adding a second entry for the same knowledge base.
  it("reuses the entry when the same knowledge base is shared again", async () => {
    const { svc, rows, state } = makeService({ name: "Team Wiki" });
    const first = await connect(svc);
    await svc.listConnections();

    state.share = null;
    await svc.listConnections();

    state.share = { name: "Team Wiki" };
    const second = await connect(svc, RESHARE_STRING);
    expect(second).toBe(first);

    const views = await svc.listConnections();
    expect(views).toHaveLength(1);
    expect(views[0]?.name).toBe("Team Wiki");
    expect(views[0]?.status).not.toBe("expired");
    const row = rows.get(first);
    expect(row?.auth.kind === "header" ? row.auth.headerName : null).toBe(
      `x-kb-token-${RESHARE_ID}`,
    );
  });

  // TEST_SCENARIO: two different knowledge bases stay two entries — the reuse keys on the knowledge base, not on the template.
  it("keeps separate entries for different knowledge bases", async () => {
    const { svc, state } = makeService({ name: "Team Wiki" });
    await connect(svc);

    state.share = { name: "Other Wiki", agentId: "agent-other" };
    await connect(svc, RESHARE_STRING);
    expect(await svc.listConnections()).toHaveLength(2);
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
