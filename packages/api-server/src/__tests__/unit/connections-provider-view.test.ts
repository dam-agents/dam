/**
 * TEST_OVERVIEW: a model-provider Connection and its Connection Template say
 * so in their views: the provider alias and the harnesses of the install's
 * harness catalog that run on it. The listing also marks one provider
 * Connection preferred: the one a template create with no provider gives the
 * default harness first, so a CLI caller can pick a provider without matching
 * template ids. Other Connections and Templates carry no provider field.
 */
import { describe, expect, it } from "vitest";
import type { Connection, HarnessView } from "api-server-api";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const harness = (
  name: HarnessView["name"],
  providers?: HarnessView["providers"],
): HarnessView => ({
  name,
  displayName: name,
  tags: [],
  experimental: false,
  ...(providers ? { providers } : {}),
});

const CATALOG: HarnessView[] = [
  harness("claude-code", ["ibm-litellm", "anthropic"]),
  harness("codex", ["ibm-litellm", "openai"]),
  harness("pi"),
];

const headerConnection = (
  id: string,
  templateId: string,
  name = id,
): Connection => ({
  id,
  ownerId: "owner",
  templateId,
  name,
  inputs: {},
  auth: {
    kind: "header",
    valueRef: { storeId: "test", path: id, field: "value" },
    headerName: "authorization",
    valueFormat: "Bearer {value}",
  },
  contributions: [],
});

const oauthConnection = (
  id: string,
  templateId: string,
  connected: boolean,
): Connection => ({
  ...headerConnection(id, templateId),
  auth: {
    kind: "oauth",
    clientId: "client",
    accessTokenRef: { storeId: "test", path: id, field: "access" },
    scopes: [],
    tokenUrl: "https://example.com/token",
    authorizationUrl: "https://example.com/authorize",
    ...(connected ? { connectedAt: 1 } : {}),
  },
});

function makeService(
  oldestFirst: Connection[],
  defaultHarness: HarnessView["name"] = "claude-code",
) {
  return createConnectionsService({
    harnesses: { default: defaultHarness, harnesses: CATALOG },
    platformProviderEnabled: async () => false,
    platformProviderKey: null,
    isOwnedAgent: async () => true,
    ownerId: "owner",
    templates: createConnectionTemplateRegistry(buildCatalog()),
    repo: unused<ConnectionsRepository>({
      get: async (id) => oldestFirst.find((c) => c.id === id) ?? null,
      listByOwner: async () =>
        [...oldestFirst].sort((a, b) => a.name.localeCompare(b.name)),
      listByOwnerOldestFirst: async () => oldestFirst,
    }),
    secretStore: unused(),
    fanOut: unused(),
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    s3CredentialProbe: unused(),
    providerBalance: unused(),
    providerKeyProbe: unused(),
    oauthCallbackUrl: "https://example.com/callback",
    brandName: "Test",
    connectionLock: (_key, fn) => fn(),
    resolveKbShare: unused(),
  });
}

describe("provider Connections in the listing", () => {
  /** TEST_SCENARIO: a user with GitHub, an IBM LiteLLM and an Anthropic
   * Connection lists them. Only the two providers carry a provider field,
   * each with its alias and the harnesses that run on it, and the Anthropic
   * one is preferred, since Claude Code is the default harness and Anthropic
   * is its home provider. */
  it("marks providers with their alias, harnesses and the preferred one", async () => {
    const svc = makeService([
      headerConnection("conn-ibm", "ibm-litellm"),
      oauthConnection("conn-gh", "github", true),
      headerConnection("conn-claude", "anthropic"),
    ]);
    const byId = new Map(
      (await svc.listConnections()).map((c) => [c.id, c.provider]),
    );
    expect(byId.get("conn-gh")).toBeUndefined();
    expect(byId.get("conn-ibm")).toEqual({
      alias: "ibm",
      harnesses: ["claude-code", "codex", "pi"],
      preferred: false,
    });
    expect(byId.get("conn-claude")).toEqual({
      alias: "anthropic",
      harnesses: ["claude-code", "pi"],
      preferred: true,
    });
  });

  /** TEST_SCENARIO: an Anthropic OAuth token runs on Claude Code alone, and
   * a Pi default harness with no home provider prefers the first alias in
   * the catalog order, IBM, over the older Anthropic API key Connection. */
  it("follows the default harness and the alias order", async () => {
    const svc = makeService(
      [
        headerConnection("conn-oauth", "anthropic-oauth"),
        headerConnection("conn-claude", "anthropic"),
        headerConnection("conn-ibm", "ibm-litellm"),
      ],
      "pi",
    );
    const byId = new Map(
      (await svc.listConnections()).map((c) => [c.id, c.provider]),
    );
    expect(byId.get("conn-oauth")).toEqual({
      alias: "anthropic",
      harnesses: ["claude-code"],
      preferred: false,
    });
    expect(byId.get("conn-claude")?.preferred).toBe(false);
    expect(byId.get("conn-ibm")?.preferred).toBe(true);
  });

  /** TEST_SCENARIO: of two Connections behind one alias, the older one is
   * preferred, as it is the one a create grants; a provider that is not
   * active is never preferred. */
  it("prefers the oldest active Connection of an alias", async () => {
    const svc = makeService([
      oauthConnection("conn-pending", "anthropic-oauth", false),
      headerConnection("conn-old", "anthropic"),
      headerConnection("conn-new", "anthropic"),
    ]);
    const preferred = (await svc.listConnections())
      .filter((c) => c.provider?.preferred)
      .map((c) => c.id);
    expect(preferred).toEqual(["conn-old"]);
    expect((await svc.getConnection("conn-old"))?.provider?.preferred).toBe(
      true,
    );
  });
});

describe("provider Connection Templates", () => {
  /** TEST_SCENARIO: the template listing names the provider templates with
   * their alias and harnesses; GitHub, an app template, carries none. */
  it("marks provider templates with their alias and harnesses", async () => {
    const svc = makeService([]);
    const byId = new Map(
      (await svc.listTemplates()).map((t) => [t.id, t.provider]),
    );
    expect(byId.get("github")).toBeUndefined();
    expect(byId.get("openai")).toEqual({
      alias: "openai",
      harnesses: ["codex", "pi"],
    });
    expect(byId.get("anthropic-oauth")).toEqual({
      alias: "anthropic",
      harnesses: ["claude-code"],
    });
  });
});
