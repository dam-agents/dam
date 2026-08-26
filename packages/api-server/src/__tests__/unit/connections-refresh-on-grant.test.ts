import { describe, it, expect } from "vitest";
import type { Connection, Contribution } from "api-server-api";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createOAuthEngine } from "../../modules/connections/infrastructure/oauth-engine.js";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import type {
  SecretMetadata,
  SecretStore,
} from "../../modules/secret-store/index.js";
import type { OAuthFlowService } from "../../modules/connections/services/oauth-flow.js";
import type { ContributionFanOut } from "../../modules/connections/services/contribution-fanout.js";

/**
 * TEST_OVERVIEW: Applying grants re-renders each granted header Connection's
 * contributions from the current template and the stored inputs, reading the
 * credential from the Connection's own Secret. A Connection created before a
 * template gained new wiring therefore upgrades in place when it is
 * (re-)attached to an agent — same identity, same credential, nothing
 * re-entered. An unchanged projection or one that cannot be re-rendered
 * leaves the grant flow untouched, and a credential rotation stays a pure
 * credential rotation.
 */

const NOW_MS = 1_800_000_000_000;
const OWNER = "owner-sub";
const AGENT = "agent-1";
const BOB_SECRET_PATH = "secret-connection:bob";

function makeRepoFake() {
  const rows = new Map<string, Connection>();
  const contributionUpdates: string[] = [];
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
    updateContributions: async (id, contributions) => {
      contributionUpdates.push(id);
      const c = rows.get(id);
      if (c) rows.set(id, { ...c, contributions });
    },
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
  return { repo, rows, contributionUpdates };
}

function makeSecretStoreFake() {
  const stored = new Map<string, Record<string, string>>();
  const putMetas: SecretMetadata[] = [];
  const store: SecretStore = {
    storeId: "test",
    mintRef: (meta) => ({
      storeId: "test",
      path: `secret-${meta.purpose}`,
      field: "",
    }),
    put: async (ref, fields, meta) => {
      stored.set(ref.path, { ...fields });
      putMetas.push(meta);
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
  return { store, stored, putMetas };
}

function makeService() {
  const { repo, rows, contributionUpdates } = makeRepoFake();
  const { store, stored, putMetas } = makeSecretStoreFake();
  const fanOutGrants: Connection[][] = [];
  const fanOut: ContributionFanOut = {
    apply: async ({ grantedConnections }) => {
      fanOutGrants.push(grantedConnections);
    },
  };
  const oauthFlow: OAuthFlowService = {
    startOAuth: async () => {
      throw new Error("startOAuth must not be called for header connections");
    },
    completeOAuth: async () => {
      throw new Error("completeOAuth must not be called");
    },
  };
  const svc = createConnectionsService({
    ownerId: OWNER,
    templates: createConnectionTemplateRegistry(buildCatalog()),
    repo,
    secretStore: store,
    fanOut,
    oauthFlow,
    oauthEngine: createOAuthEngine({
      pendingStore: createMemoryTtlStore(600_000),
      now: () => NOW_MS,
    }),
    githubAppEngine: createGitHubAppEngine({ now: () => NOW_MS }),
    oauthCallbackUrl: "https://cb.example/oauth/callback",
    brandName: "Test",
    connectionLock: <T>(_key: string, fn: () => Promise<T>): Promise<T> => fn(),
  });
  return { svc, rows, stored, putMetas, contributionUpdates, fanOutGrants };
}

function envNames(contributions: Contribution[]): string[] {
  return contributions
    .filter(
      (c): c is Extract<Contribution, { kind: "env" }> => c.kind === "env",
    )
    .map((c) => c.name);
}

async function createBob(
  svc: ReturnType<typeof makeService>["svc"],
): Promise<string> {
  return svc.createFromTemplate({
    templateId: "bob",
    name: "bob",
    authKind: "header",
    value: "bob-key-1",
    configInputs: { model: "premium-shell", teamId: "t-1" },
  });
}

function stripInferenceWiring(conn: Connection): Connection {
  return {
    ...conn,
    contributions: conn.contributions.filter(
      (c) =>
        !(
          c.kind === "env" &&
          (c.name.startsWith("OPENAI_") || c.name.startsWith("CODEX_"))
        ) && !(c.kind === "egress-inject" && c.headerName === "User-Agent"),
    ),
  };
}

describe("granting re-renders contributions from the current template", () => {
  /**
   * TEST_SCENARIO: A Bob connection created before the template contributed
   * the inference wiring holds only the shell env. Attaching it to an agent
   * must upgrade it in place: the re-rendered contributions land in the
   * repository and reach the fan-out, the config-input pins survive, and the
   * secret is rewritten with annotations rebuilt from the new contributions —
   * all without the credential ever being re-entered.
   */
  it("upgrades a stale connection when its grant is applied", async () => {
    const { svc, rows, stored, putMetas, fanOutGrants } = makeService();
    const id = await createBob(svc);
    rows.set(id, stripInferenceWiring(rows.get(id)!));

    await svc.setAgentConnections(AGENT, [id]);

    const names = envNames(rows.get(id)!.contributions);
    expect(names).toContain("OPENAI_BASE_URL");
    expect(names).toContain("OPENAI_API_KEY");
    expect(names).toContain("BOB_SHELL_MODEL");
    expect(names).toContain("BOB_TEAM_ID");

    expect(envNames(fanOutGrants.at(-1)![0]!.contributions)).toContain(
      "OPENAI_BASE_URL",
    );

    expect(stored.get(BOB_SECRET_PATH)!["value"]).toBe("bob-key-1");
    const refreshMeta = putMetas.at(-1)!;
    expect(refreshMeta.extraLabels).toMatchObject({
      "agent-platform.ai/connection": id,
    });
    expect(
      refreshMeta.extraAnnotations?.["agent-platform.ai/env-mappings"],
    ).toContain("OPENAI_BASE_URL");
  });

  /**
   * TEST_SCENARIO: A grant on a connection whose projection is already
   * current must not rewrite anything — no contribution write, no secret
   * rewrite — while the fan-out still runs as part of the grant flow.
   */
  it("leaves an up-to-date connection untouched", async () => {
    const { svc, contributionUpdates, putMetas, fanOutGrants } = makeService();
    const id = await createBob(svc);
    const putsAfterCreate = putMetas.length;

    await svc.setAgentConnections(AGENT, [id]);

    expect(contributionUpdates).toEqual([]);
    expect(putMetas).toHaveLength(putsAfterCreate);
    expect(fanOutGrants).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: The refresh rewrites the secret wholesale, so it must drop
   * SDS files for injections the template no longer produces while carrying
   * every non-SDS field (such as an upstream CA) across untouched.
   */
  it("drops stale SDS fields and carries unrelated fields", async () => {
    const { svc, rows, stored } = makeService();
    const id = await createBob(svc);
    rows.set(id, stripInferenceWiring(rows.get(id)!));
    const secret = stored.get(BOB_SECRET_PATH)!;
    secret["host-c3RhbGU.sds.yaml"] = "stale";
    secret["upstream-ca.crt"] = "PEM";

    await svc.setAgentConnections(AGENT, [id]);

    const after = stored.get(BOB_SECRET_PATH)!;
    expect(after["host-c3RhbGU.sds.yaml"]).toBeUndefined();
    expect(after["upstream-ca.crt"]).toBe("PEM");
    expect(after["value"]).toBe("bob-key-1");
  });

  /**
   * TEST_SCENARIO: A projection that cannot be re-rendered — the template is
   * gone from the catalog, or the secret no longer holds a credential — must
   * never block the grant itself.
   */
  it("still grants when the re-render is impossible", async () => {
    const { svc, rows, stored, contributionUpdates, fanOutGrants } =
      makeService();
    const id = await createBob(svc);
    rows.set(id, {
      ...stripInferenceWiring(rows.get(id)!),
      templateId: "gone",
    });

    await svc.setAgentConnections(AGENT, [id]);

    rows.set(id, { ...rows.get(id)!, templateId: "bob" });
    delete stored.get(BOB_SECRET_PATH)!["value"];

    await svc.setAgentConnections(AGENT, [id]);

    expect(contributionUpdates).toEqual([]);
    expect(fanOutGrants).toHaveLength(2);
    expect(envNames(rows.get(id)!.contributions)).not.toContain(
      "OPENAI_BASE_URL",
    );
  });

  /**
   * TEST_SCENARIO: Rotating the credential stays a pure credential rotation —
   * the stored contributions do not move, keeping the documented rotation
   * invariant. The grant flow, not the rotate flow, is the upgrade path.
   */
  it("keeps credential rotation contribution-free", async () => {
    const { svc, rows, stored, contributionUpdates } = makeService();
    const id = await createBob(svc);
    rows.set(id, stripInferenceWiring(rows.get(id)!));

    await svc.update(id, "bob-key-2");

    expect(contributionUpdates).toEqual([]);
    expect(stored.get(BOB_SECRET_PATH)!["value"]).toBe("bob-key-2");
    expect(envNames(rows.get(id)!.contributions)).not.toContain(
      "OPENAI_BASE_URL",
    );
  });
});
