import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_TEMPLATE_IDS,
  providerTypeForTemplateId,
  type Connection,
} from "api-server-api";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import { startPlatformProviderSaga } from "../../modules/connections/sagas/platform-provider.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import { configureLogger } from "../../core/logger.js";
import { emit, events$, EventType, type DomainEvent } from "../../events.js";

/**
 * TEST_OVERVIEW: the built-in provider's Connection follows its feature flag:
 * turning the flag on gives the user exactly one keyless platform-llm
 * Connection named after the brand, which the attach-first-provider saga
 * picks up; turning it off removes it and revokes it from the agents holding
 * it; the user cannot delete or create it by hand; and an install with no
 * model server offers no template to create it from.
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

const ENDPOINT = { baseUrl: "http://llm.models.svc:8000", model: "m-flash" };

function makeService(opts: { configured?: boolean } = {}) {
  const rows = new Map<string, Connection>();
  const fannedOut: string[] = [];
  const flag = { on: false };
  const svc = createConnectionsService({
    isOwnedAgent: async () => true,
    ownerId: "owner",
    templates: createConnectionTemplateRegistry(
      buildCatalog(
        {},
        { platformProvider: (opts.configured ?? true) ? ENDPOINT : null },
      ),
    ),
    repo: unused<ConnectionsRepository>({
      insert: async (c) => void rows.set(c.id, c),
      get: async (id) => rows.get(id) ?? null,
      listByOwner: async () => [...rows.values()],
      delete: async (id) => void rows.delete(id),
      listAgentsForConnection: async () => ["agent-1"],
      listConnectionsForAgent: async () => [],
    }),
    secretStore: unused<SecretStore>(),
    fanOut: unused({
      apply: async (input) => void fannedOut.push(input.agentId),
    }),
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    s3CredentialProbe: unused(),
    providerBalance: unused(),
    providerKeyProbe: unused(),
    oauthCallbackUrl: "https://example.com/callback",
    brandName: "Acme",
    connectionLock: (_key, fn) => fn(),
    resolveKbShare: unused(),
    platformProviderEnabled: async () => flag.on,
  });
  return { svc, rows, flag, fannedOut };
}

const platformRows = (rows: Map<string, Connection>) =>
  [...rows.values()].filter((c) => c.templateId === "platform-llm");

function recordEvents(): DomainEvent[] {
  const seen: DomainEvent[] = [];
  const sub = events$().subscribe((e) => seen.push(e));
  subs.push(sub);
  return seen;
}

const subs: { unsubscribe(): void }[] = [];
afterEach(() => {
  for (const s of subs.splice(0)) s.unsubscribe();
});

function toggle(on: boolean, flag: { on: boolean }) {
  flag.on = on;
  emit({
    type: EventType.FeatureFlagChanged,
    actorSub: "owner",
    surface: "test",
    feature: "platform-provider",
    enabled: on,
  });
}

describe("platform provider connection", () => {
  // TEST_SCENARIO: enabling the feature twice and listing in between leaves one keyless Connection named after the brand, announced once as a provider so the attach-first-provider saga grants it.
  it("creates exactly one connection when the flag is turned on", async () => {
    const { svc, rows, flag } = makeService();
    const seen = recordEvents();
    subs.push(startPlatformProviderSaga(() => svc));

    toggle(true, flag);
    await vi.waitFor(() => expect(platformRows(rows)).toHaveLength(1));
    toggle(true, flag);
    const views = await svc.listConnections();

    expect(platformRows(rows)).toHaveLength(1);
    const view = views.find((v) => v.templateId === "platform-llm")!;
    expect(view).toMatchObject({
      name: "Acme",
      status: "active",
      authKind: "none",
      category: "app",
      hosts: ["llm.models.svc"],
    });
    expect(view.contributions).toContainEqual({
      kind: "egress-allow",
      host: "llm.models.svc",
      port: 8000,
    });
    expect(view.contributions).toContainEqual({
      kind: "env",
      name: "OPENAI_BASE_URL",
      placeholder: "http://llm.models.svc:8000/v1",
    });
    const created = seen.filter((e) => e.type === EventType.ConnectionCreated);
    expect(created).toHaveLength(1);
    expect(PROVIDER_TEMPLATE_IDS.has("platform-llm")).toBe(true);
    expect(providerTypeForTemplateId("platform-llm")).toBe("platform");
  });

  // TEST_SCENARIO: with the install's mode on there is no flag change, so the first listing provisions the Connection.
  it("provisions the connection lazily on listing while the flag is on", async () => {
    const { svc, rows, flag } = makeService();
    flag.on = true;
    await svc.listConnections();
    await svc.listConnections();
    expect(platformRows(rows)).toHaveLength(1);
  });

  // TEST_SCENARIO: disabling the feature removes the Connection and re-delivers the agents that held it.
  it("removes the connection when the flag is turned off", async () => {
    const { svc, rows, flag, fannedOut } = makeService();
    flag.on = true;
    await svc.reconcilePlatformConnection();
    subs.push(startPlatformProviderSaga(() => svc));

    toggle(false, flag);
    await vi.waitFor(() => expect(platformRows(rows)).toHaveLength(0));
    expect(fannedOut).toEqual(["agent-1"]);
  });

  // TEST_SCENARIO: the user's own delete and create paths refuse the built-in provider.
  it("refuses to delete or create the connection by hand", async () => {
    const { svc, rows, flag } = makeService();
    flag.on = true;
    await svc.reconcilePlatformConnection();
    const [conn] = platformRows(rows);

    await expect(svc.deleteConnection(conn!.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      svc.createFromTemplate({
        templateId: "platform-llm",
        name: "mine",
        authKind: "none",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(platformRows(rows)).toHaveLength(1);
  });

  // TEST_SCENARIO: an install with no model server has no template, so even a flag that reads on creates nothing.
  it("creates nothing without a configured base URL", async () => {
    const { svc, rows, flag } = makeService({ configured: false });
    flag.on = true;
    await svc.listConnections();
    expect(rows.size).toBe(0);
    expect(buildCatalog().some((t) => t.id === "platform-llm")).toBe(false);
  });
});
