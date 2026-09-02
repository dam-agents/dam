import { describe, expect, it } from "vitest";
import type { Connection } from "api-server-api";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";
import { createOAuthEngine } from "../../modules/connections/infrastructure/oauth-engine.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import { connectionRefreshLockKey } from "../../modules/connections/services/oauth-refresh.js";
import type { OAuthFlowService } from "../../modules/connections/services/oauth-flow.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import { configureLogger } from "../../core/logger.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";

/**
 * TEST_OVERVIEW: the consumer side of a shared knowledge base outliving the
 * share link it was connected through — one entry per knowledge base, so
 * re-sharing re-points the row it already has instead of adding a second one,
 * and the owner's public name (readable only to a consumer whose secret still
 * works) is remembered so a row that stopped working still says which
 * knowledge base it was, beside the expired status that explains it.
 * Re-pointing is a credential rotation on an existing row, so it is covered as
 * one: serialized under the connection lock, audited, and refusing rather than
 * duplicating when the row it matched cannot take the new link. Shares are
 * faked by id and authenticated by comparing the presented secret to theirs,
 * so an owner's rotation and a re-share are modelled the way they happen.
 */

const OWNER = "owner-sub";
const AGENT = "agent-wiki";
const SHARE_ID = "831359c58153";
const RESHARE_ID = "9f2c41ab7710";
const SECRET = "s".repeat(43);
const RESHARE_SECRET = "r".repeat(43);
const SHARE_STRING = `kbshare_${SHARE_ID}_${SECRET}`;
const RESHARE_STRING = `kbshare_${RESHARE_ID}_${RESHARE_SECRET}`;
const ROW_SLUG = `kb-${AGENT}`;

const logLines: string[] = [];
configureLogger({ level: "info", write: (line) => logLines.push(line) });

function auditRecords(): {
  msg: string;
  detail?: Record<string, unknown>;
}[] {
  return logLines.map(
    (line) =>
      JSON.parse(line) as { msg: string; detail?: Record<string, unknown> },
  );
}

interface FakeShare {
  secret: string;
  name: string | null;
  agentId?: string;
}

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
    mergeInputs: async (id, patch) => {
      const c = rows.get(id);
      if (c) rows.set(id, { ...c, inputs: { ...c.inputs, ...patch } });
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

function makeSecretStoreFake(): {
  store: SecretStore;
  stored: Map<string, Record<string, string>>;
} {
  const stored = new Map<string, Record<string, string>>();
  let minted = 0;
  const store: SecretStore = {
    storeId: "test",
    mintRef: (meta) => ({
      storeId: "test",
      path: `secret-${meta.purpose}-${(minted += 1)}`,
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
  return { store, stored };
}

function makeService(
  share: { name: string | null; secret?: string; agentId?: string } | null,
  opts: { onLock?: () => void } = {},
) {
  const { repo, rows } = makeRepoFake();
  const { store: secretStore, stored: secrets } = makeSecretStoreFake();
  const shares = new Map<string, FakeShare>();
  if (share) shares.set(SHARE_ID, { secret: SECRET, ...share });
  const state = { shares, resolveCalls: 0 };
  const lockKeys: string[] = [];
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
    secretStore,
    fanOut: { apply: async () => {} },
    oauthFlow,
    oauthEngine: createOAuthEngine({
      pendingStore: createMemoryTtlStore(600_000),
    }),
    githubAppEngine: createGitHubAppEngine(),
    oauthCallbackUrl: "https://cb.example/oauth/callback",
    brandName: "Test",
    connectionLock: <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      lockKeys.push(key);
      opts.onLock?.();
      return fn();
    },
    resolveKbShare: async (shareId, presented) => {
      state.resolveCalls += 1;
      const found = state.shares.get(shareId);
      if (!found) return null;
      return {
        agentId: found.agentId ?? AGENT,
        name: found.name,
        reachable: presented === found.secret,
      };
    },
  });
  return { svc, rows, state, lockKeys, secrets };
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
  // TEST_SCENARIO: while the share resolves, the consumer sees the owner's public name rather than the internal slug the connection is stored under.
  it("shows the owner's public name for a live share", async () => {
    const { svc } = makeService({ name: "Team Wiki" });
    await connect(svc);
    const [view] = await svc.listConnections();
    expect(view?.name).toBe("Team Wiki");
    expect(view?.status).not.toBe("expired");
  });

  // TEST_SCENARIO: the name is remembered on the connection, so unsharing leaves a row that still says which knowledge base it was, marked expired.
  it("keeps the last known name after the share is revoked", async () => {
    const { svc, state } = makeService({ name: "Team Wiki" });
    await connect(svc);

    state.shares.delete(SHARE_ID);
    const [view] = await svc.listConnections();
    expect(view?.name).toBe("Team Wiki");
    expect(view?.status).toBe("expired");
  });

  // TEST_SCENARIO: a rename by the owner replaces the remembered name on the next successful resolve, so the consumer never keeps a stale one.
  it("refreshes the remembered name when the owner renames the share", async () => {
    const { svc, rows, state } = makeService({ name: "Team Wiki" });
    const id = await connect(svc);

    state.shares.set(SHARE_ID, { secret: SECRET, name: "Platform Wiki" });
    const [view] = await svc.listConnections();
    expect(view?.name).toBe("Platform Wiki");
    expect(rows.get(id)?.inputs["sharedKbName"]).toBe("Platform Wiki");
  });

  // TEST_SCENARIO: rotating the share secret cuts this consumer off, and the public name is readable only to a consumer whose secret still works — so the name it last saw freezes rather than tracking renames it should no longer see.
  it("stops following the public name once its secret stops working", async () => {
    const { svc, rows, state } = makeService({ name: "Team Wiki" });
    const id = await connect(svc);

    state.shares.set(SHARE_ID, {
      secret: "rotated-secret",
      name: "Renamed After Rotation",
    });
    const [view] = await svc.listConnections();
    expect(view?.name).toBe("Team Wiki");
    expect(view?.status).toBe("expired");
    expect(rows.get(id)?.inputs["sharedKbName"]).toBe("Team Wiki");
  });

  // TEST_SCENARIO: the knowledge base a connection reaches is settled by the same lookup that authorizes the link — there is no second lookup for a revocation to slip between — and it is what the row is named after, not the link that happened to carry it.
  it("records the knowledge base the link authorized, and names the row after it", async () => {
    const { svc, rows, state } = makeService({ name: "Team Wiki" });
    const id = await connect(svc);

    expect(state.resolveCalls).toBe(1);
    expect(rows.get(id)?.inputs["sharedKbAgentId"]).toBe(AGENT);
    expect(rows.get(id)?.name).toBe(ROW_SLUG);
  });

  // TEST_SCENARIO: unsharing and re-sharing mints a new share id for the same knowledge base — connecting the new link re-points the row that exists, secret and header alike, rather than adding a second entry beside it.
  it("reuses the entry when the same knowledge base is shared again", async () => {
    const { svc, rows, state, secrets } = makeService({ name: "Team Wiki" });
    const first = await connect(svc);

    state.shares.delete(SHARE_ID);
    state.shares.set(RESHARE_ID, {
      secret: RESHARE_SECRET,
      name: "Team Wiki",
    });
    const second = await connect(svc, RESHARE_STRING);

    expect(second).toBe(first);
    expect(await svc.listConnections()).toHaveLength(1);
    const row = rows.get(first);
    expect(row?.name).toBe(ROW_SLUG);
    expect(row?.auth.kind === "header" ? row.auth.headerName : null).toBe(
      `x-kb-token-${RESHARE_ID}`,
    );
    expect([...secrets.values()].map((fields) => fields["value"])).toEqual([
      RESHARE_SECRET,
    ]);
  });

  // TEST_SCENARIO: two knowledge bases stay two entries, each resolving its own share — the reuse keys on the knowledge base, not on the template.
  it("keeps separate entries for different knowledge bases", async () => {
    const { svc, state } = makeService({ name: "Team Wiki" });
    await connect(svc);

    state.shares.set(RESHARE_ID, {
      secret: RESHARE_SECRET,
      name: "Other Wiki",
      agentId: "agent-other",
    });
    await connect(svc, RESHARE_STRING);

    const views = await svc.listConnections();
    expect(views.map((v) => v.name).sort()).toEqual([
      "Other Wiki",
      "Team Wiki",
    ]);
  });

  // TEST_SCENARIO: re-pointing rotates the credential of a row that already exists, so it serializes under the same per-connection lock as every other credential write and leaves the audit trail a rotation must leave.
  it("re-points under the connection lock and audits the rotation", async () => {
    const { svc, state, lockKeys } = makeService({ name: "Team Wiki" });
    const first = await connect(svc);

    logLines.length = 0;
    state.shares.set(RESHARE_ID, {
      secret: RESHARE_SECRET,
      name: "Team Wiki",
    });
    await connect(svc, RESHARE_STRING);

    expect(lockKeys).toEqual([connectionRefreshLockKey(first)]);
    const audited = auditRecords().filter((r) => r.msg === "connection.update");
    expect(audited).toHaveLength(1);
    expect(audited[0]?.detail).toMatchObject({ repointed: true });
  });

  // TEST_SCENARIO: the row matched outside the lock can be deleted before the lock is held, so the re-point stands down and the link connects as a fresh row instead of handing back an id that no longer exists.
  it("connects fresh when the matched row vanished under the lock", async () => {
    let first = "";
    const { svc, rows, state } = makeService(
      { name: "Team Wiki" },
      { onLock: () => rows.delete(first) },
    );
    first = await connect(svc);

    state.shares.set(RESHARE_ID, {
      secret: RESHARE_SECRET,
      name: "Team Wiki",
    });
    const second = await connect(svc, RESHARE_STRING);
    expect(second).not.toBe(first);
    expect(rows.size).toBe(1);
  });

  // TEST_SCENARIO: a row that identifies this knowledge base but holds a credential no link can be written into is refused — it cannot happen through the create path, and silently adding the second entry beside it is the outcome the identity exists to prevent.
  it("refuses a matched row that cannot be re-pointed", async () => {
    const { svc, rows, state } = makeService({ name: "Team Wiki" });
    const first = await connect(svc);
    rows.set(first, { ...rows.get(first)!, auth: { kind: "none" } });

    state.shares.set(RESHARE_ID, {
      secret: RESHARE_SECRET,
      name: "Team Wiki",
    });
    await expect(connect(svc, RESHARE_STRING)).rejects.toThrow(
      /cannot be re-pointed/,
    );
    expect(rows.size).toBe(1);
  });

  // TEST_SCENARIO: a link for a share that has stopped resolving is refused outright — no half-identified row is left behind for a later re-share to duplicate.
  it("refuses a link whose share no longer resolves", async () => {
    const { svc, rows } = makeService(null);
    await expect(connect(svc)).rejects.toThrow(/unknown or revoked/);
    expect(rows.size).toBe(0);
  });
});
