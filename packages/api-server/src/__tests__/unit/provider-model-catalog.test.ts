import {
  type Connection,
  type HarnessCatalog,
  harnessCatalogOf,
  type HarnessView,
  type ModelDiscovery,
  type PriceTable,
} from "api-server-api";
import { describe, expect, it } from "vitest";
import {
  memorySecretStore,
  newConnectionsStore,
  serviceHarness,
  type StoredSecret,
} from "../helpers/connections-service.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { createProviderModelCatalog } from "../../modules/connections/services/provider-model-catalog.js";
import {
  loadShippedHarnessFacts,
  type ShippedHarnessFacts,
} from "../../modules/connections/infrastructure/shipped-harness-manifests.js";

const SECRET_PATH = "connection:anthropic";
const CREDENTIAL = "sk-ant-test";

const harness = (
  name: HarnessView["name"],
  providers: HarnessView["providers"],
): HarnessView => ({
  name,
  displayName: name,
  providers,
  tags: [],
  experimental: false,
});

const harnesses: Pick<HarnessCatalog, "default" | "harnesses"> = {
  default: "claude-code",
  harnesses: [
    harness("claude-code", ["anthropic", "openai", "bedrock"]),
    harness("pi", ["anthropic", "openai"]),
    harness("codex", ["openai"]),
    harness("bob", ["bob"]),
  ],
};

const shipped: Record<string, ShippedHarnessFacts> = Object.fromEntries(
  harnesses.harnesses.map((h) => [
    h.name,
    {
      name: h.name,
      modelRouter: true,
      harnessConfig: true,
      sessionModel: true,
      sessionSettings: ["mode", "effort"],
      derivedStartMode: ["mode"],
      catalog: {
        options: [
          {
            id: "effort",
            name: "Effort",
            category: "thought_level",
            choices: [{ value: "high", name: "High" }],
          },
        ],
      },
      ...(h.name === "claude-code" && {
        native: {
          templates: ["bedrock"],
          models: ["fable", "opus", "sonnet", "haiku"],
        },
      }),
    },
  ]),
);

const table: PriceTable = {
  source: { url: "test", commit: "test", fetchedAt: "2026-10-26" },
  models: {},
};

const secrets = new Map<string, StoredSecret>([
  [
    SECRET_PATH,
    {
      fields: { "": CREDENTIAL },
      annotations: {},
      purpose: "connection:anthropic",
    },
  ],
]);

const connection = (input: {
  id: string;
  templateId: string;
  env?: Record<string, string>;
}): Connection => ({
  id: input.id,
  ownerId: "owner",
  templateId: input.templateId,
  name: input.id,
  inputs: {},
  auth: {
    kind: "header",
    valueRef: { storeId: "test", path: SECRET_PATH, field: "" },
    headerName: "x-api-key",
    valueFormat: "{value}",
  },
  contributions: Object.entries(input.env ?? {}).map(([name, placeholder]) => ({
    kind: "env" as const,
    name,
    placeholder,
  })),
});

const observed =
  (entries: { id: string; contextWindow?: number }[]): ModelDiscovery =>
  async () => ({
    status: "observed",
    via: "ANTHROPIC_BASE_URL",
    models: entries.map((e) => ({ value: e.id, name: e.id })),
    entries: entries.map((e) => ({
      id: e.id,
      name: e.id,
      ...(e.contextWindow !== undefined && {
        info: { contextWindow: e.contextWindow },
      }),
    })),
  });

describe("the owner's provider model catalog", () => {
  it("lists a connection's models with the harnesses that can run them", async () => {
    const calls: { env: Record<string, string> }[] = [];
    const catalog = createProviderModelCatalog({
      secretStore: memorySecretStore(secrets),
      discover: async (spec, env) => {
        calls.push({ env });
        return observed([
          { id: "claude-sonnet-5", contextWindow: 200_000 },
          { id: "claude-tiny", contextWindow: 8_000 },
        ])(spec, env);
      },
      table,
      shipped,
    });
    const view = await catalog.read(
      [connection({ id: "conn-1", templateId: "anthropic" })],
      harnesses,
    );

    expect(view.defaultHarness).toBe("claude-code");
    expect(view.modelRouter).toBe(true);
    expect(view.harnesses.find((h) => h.name === "claude-code")).toMatchObject({
      sessionSettings: ["mode", "effort"],
      nativeTemplates: ["bedrock"],
    });
    expect(view.providers).toHaveLength(1);
    expect(view.providers[0]).toMatchObject({
      connectionId: "conn-1",
      alias: "anthropic",
      template: "anthropic",
      status: "listed",
      harnesses: ["claude-code", "pi"],
    });
    expect(view.providers[0]!.models.map((m) => m.name)).toEqual([
      "anthropic/claude-sonnet-5",
      "anthropic/claude-tiny",
    ]);
    expect(view.providers[0]!.models[0]!.harnesses).toEqual([
      "claude-code",
      "pi",
    ]);
    expect(view.providers[0]!.models[1]!.harnesses).toEqual([]);
    expect(calls[0]!.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    expect(calls[0]!.env.ANTHROPIC_API_KEY).toBe(CREDENTIAL);
  });

  it("skips a connection whose template is not a model provider", async () => {
    const catalog = createProviderModelCatalog({
      secretStore: memorySecretStore(secrets),
      discover: observed([]),
      table,
      shipped,
    });
    const view = await catalog.read(
      [connection({ id: "conn-github", templateId: "github" })],
      harnesses,
    );

    expect(view.providers).toEqual([]);
  });

  it("marks a template the router never lists as unsupported", async () => {
    let listed = false;
    const catalog = createProviderModelCatalog({
      secretStore: memorySecretStore(secrets),
      discover: async () => {
        listed = true;
        return { status: "not-configured" };
      },
      table,
      shipped,
    });
    const view = await catalog.read(
      [connection({ id: "conn-bedrock", templateId: "bedrock" })],
      harnesses,
    );

    expect(listed).toBe(false);
    expect(view.providers[0]).toMatchObject({
      status: "listed",
      harnesses: ["claude-code"],
    });
    expect(view.providers[0]!.models.map((m) => m.name)).toEqual([
      "bedrock/fable",
      "bedrock/opus",
      "bedrock/sonnet",
      "bedrock/haiku",
    ]);
    expect(view.providers[0]!.models[0]!.harnesses).toEqual(["claude-code"]);
  });

  /** TEST_SCENARIO: Bob's gateway speaks a dialect Pi speaks, but the installed harness catalog runs Bob's provider on Bob alone, so Pi is never offered a Bob model and a pick from it cannot be dropped. */
  it("offers a Bob model to Bob and never to Pi", async () => {
    const catalog = createProviderModelCatalog({
      secretStore: memorySecretStore(secrets),
      discover: observed([{ id: "granite-4-1-8b" }]),
      table,
      shipped,
    });
    const view = await catalog.read(
      [connection({ id: "conn-bob", templateId: "bob" })],
      harnesses,
    );
    expect(view.providers[0]!.harnesses).toEqual(["bob"]);
    expect(harnessCatalogOf(view, "bob").providers[0]!.models).toHaveLength(1);
    expect(harnessCatalogOf(view, "pi").providers[0]).toMatchObject({
      status: "unsupported",
      models: [],
    });
  });

  /** TEST_SCENARIO: an agent's picker lists only the providers granted to that agent; the owner's other Connections stay out of its catalog. */
  it("lists an agent's catalog from its granted connections alone", async () => {
    const store = newConnectionsStore();
    for (const id of ["conn-granted", "conn-other"])
      store.rows.set(id, connection({ id, templateId: "anthropic" }));
    store.grants.add("conn-granted|agent-1");
    const read: string[][] = [];
    const { svc } = serviceHarness({
      templates: createConnectionTemplateRegistry(buildCatalog()),
      store,
      brandName: "Acme",
      providerModelCatalog: {
        read: async (connections) => {
          read.push(connections.map((c) => c.id));
          return {
            defaultHarness: "claude-code",
            modelRouter: true,
            harnesses: [],
            providers: [],
          };
        },
      },
    });
    await svc.modelCatalog("agent-1");
    await svc.modelCatalog();
    expect(read).toEqual([["conn-granted"], ["conn-granted", "conn-other"]]);
  });

  // TEST_SCENARIO: an agent's catalog covers the image harness its runtime reports, both from its granted providers and, while the picker offers unattached ones, from every provider its owner holds; the owner-level catalog, which names no agent, never does.
  it("adds the agent's reported image harness to its catalog alone", async () => {
    const store = newConnectionsStore();
    store.rows.set(
      "conn-1",
      connection({ id: "conn-1", templateId: "openai" }),
    );
    store.grants.add("conn-1|agent-1");
    const seen: { names: string[]; image: string[] }[] = [];
    const { svc } = serviceHarness({
      templates: createConnectionTemplateRegistry(buildCatalog()),
      store,
      brandName: "Acme",
      carriedHarnesses: async () => [
        {
          name: "image-agent",
          harnessConfig: false,
          sessionModel: false,
          dialects: ["openai-chat"],
        },
      ],
      providerModelCatalog: {
        read: async (_connections, views, image = []) => {
          seen.push({
            names: views.harnesses.map((h) => h.name),
            image: image.map((h) => h.name),
          });
          return {
            defaultHarness: "claude-code",
            modelRouter: true,
            harnesses: [],
            providers: [],
          };
        },
      },
    });
    await svc.modelCatalog("agent-1");
    await svc.modelCatalog(undefined, { harnessesOf: "agent-1" });
    await svc.modelCatalog();
    expect(seen).toEqual([
      { names: ["image-agent"], image: ["image-agent"] },
      { names: ["image-agent"], image: ["image-agent"] },
      { names: [], image: [] },
    ]);
  });

  // TEST_SCENARIO: a reported image harness that speaks a dialect the provider serves gets the provider's models and keeps the catalog routed, so the picker offers them rather than treating the agent as one on an old runtime.
  it("lists a provider's models for a routed image harness", async () => {
    const catalog = createProviderModelCatalog({
      secretStore: memorySecretStore(secrets),
      discover: observed([{ id: "gpt-5", contextWindow: 400_000 }]),
      table,
      shipped,
    });
    const image = {
      name: "image-agent",
      harnessConfig: false,
      sessionModel: false,
      dialects: ["openai-chat"],
    };
    const view = await catalog.read(
      [connection({ id: "conn-1", templateId: "openai" })],
      {
        default: harnesses.default,
        harnesses: [
          ...harnesses.harnesses,
          {
            name: "image-agent",
            displayName: "Image Agent",
            providers: ["openai"],
            tags: [],
            experimental: false,
          },
        ],
      },
      [image],
    );
    expect(view.modelRouter).toBe(true);
    expect(view.harnesses.find((h) => h.name === "image-agent")).toEqual(image);
    expect(harnessCatalogOf(view, "image-agent").providers[0]).toMatchObject({
      status: "listed",
      models: [expect.objectContaining({ name: "openai/gpt-5" })],
    });
  });

  it("keeps the last good list when a later listing fails", async () => {
    let fail = false;
    let calls = 0;
    let at = 1_000;
    const catalog = createProviderModelCatalog({
      secretStore: memorySecretStore(secrets),
      discover: async () => {
        calls++;
        return fail
          ? { status: "unavailable" }
          : {
              status: "observed",
              via: "x",
              models: [],
              entries: [{ id: "claude-sonnet-5", name: "claude-sonnet-5" }],
            };
      },
      table,
      shipped,
      now: () => new Date(at),
      refreshMs: 1_000,
    });
    const connections = [connection({ id: "conn-1", templateId: "anthropic" })];
    await catalog.read(connections, harnesses);
    fail = true;
    at += 2_000;
    await catalog.read(connections, harnesses);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const view = await catalog.read(connections, harnesses);

    expect(calls).toBeGreaterThan(1);
    expect(view.providers[0]!.status).toBe("unavailable");
    expect(view.providers[0]!.models.map((m) => m.name)).toEqual([
      "anthropic/claude-sonnet-5",
    ]);
  });

  it("lists a connection once within the refresh window", async () => {
    let calls = 0;
    const catalog = createProviderModelCatalog({
      secretStore: memorySecretStore(secrets),
      discover: async () => {
        calls++;
        return { status: "observed", via: "x", models: [], entries: [] };
      },
      table,
      shipped,
    });
    const connections = [connection({ id: "conn-1", templateId: "anthropic" })];
    await catalog.read(connections, harnesses);
    await catalog.read(connections, harnesses);

    expect(calls).toBe(1);
  });
});

describe("the shipped harness manifests", () => {
  it("carries the settings catalog and the native tiers from the agent manifests", () => {
    const facts = loadShippedHarnessFacts();

    expect(Object.keys(facts).sort()).toEqual(
      expect.arrayContaining(["claude-code", "codex", "pi", "bob", "copilot"]),
    );
    expect(facts["claude-code"]?.native).toEqual({
      templates: ["bedrock"],
      models: ["fable", "opus", "sonnet", "haiku"],
    });
    expect(
      facts["codex"]?.catalog?.options.some((o) => o.id === "effort"),
    ).toBe(true);
    expect(facts["claude-code"]?.sessionSettings).toContain("effort");
  });
});
