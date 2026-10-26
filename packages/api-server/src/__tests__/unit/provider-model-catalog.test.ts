import type {
  Connection,
  HarnessCatalog,
  HarnessView,
  ModelDiscovery,
  PriceTable,
} from "api-server-api";
import { describe, expect, it } from "vitest";
import {
  memorySecretStore,
  type StoredSecret,
} from "../helpers/connections-service.js";
import { createProviderModelCatalog } from "../../modules/connections/services/provider-model-catalog.js";

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
    });
    const view = await catalog.read(
      [connection({ id: "conn-1", templateId: "anthropic" })],
      harnesses,
    );

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
    });
    const view = await catalog.read(
      [connection({ id: "conn-bedrock", templateId: "bedrock" })],
      harnesses,
    );

    expect(listed).toBe(false);
    expect(view.providers[0]).toMatchObject({
      status: "unsupported",
      harnesses: ["claude-code"],
      models: [],
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
    });
    const connections = [connection({ id: "conn-1", templateId: "anthropic" })];
    await catalog.read(connections, harnesses);
    await catalog.read(connections, harnesses);

    expect(calls).toBe(1);
  });
});
