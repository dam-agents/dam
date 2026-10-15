import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  LeaseEnvReader,
  RuntimeEnvReader,
} from "../../core/runtime-env.js";
import { createHarnessConfigPlugin } from "../../modules/runtime-channel/drivers/harness-config-plugin.js";
import type { ModelDiscovery } from "../../modules/runtime-channel/infrastructure/model-discovery.js";
import type { HarnessConfigBinding } from "../../modules/runtime-channel/manifest.js";

function asLease(reader: RuntimeEnvReader): LeaseEnvReader {
  return { ...reader, providers: () => [], forLease: () => reader.current() };
}

const noop = () => {};
const noEnv: RuntimeEnvReader = { current: () => ({}), ready: () => true };
const noDiscovery: ModelDiscovery = async () => ({
  status: "not-configured",
});

const BINDING: HarnessConfigBinding = {
  file: "$HOME/.claude/settings.json",
  format: "json",
  keys: {
    model: "model",
    mode: "permissions.defaultMode",
    configOptions: { effort: "effortLevel" },
  },
};

describe("createReadHarnessConfig", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hcr-"));
    mkdirSync(join(home, ".claude"), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const writeSettings = (obj: unknown) =>
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(obj));

  const read = (discoverModels: ModelDiscovery, binding = BINDING) =>
    createHarnessConfigPlugin({
      harness: "test",
      binding,
      agentHome: home,
      envReader: asLease(noEnv),
      discoverModels,
      log: noop,
    }).readCurrent;

  it("maps the config file back to logical fields and merges discovered models", async () => {
    writeSettings({
      model: "opus",
      permissions: { defaultMode: "auto" },
      effortLevel: "high",
    });
    const out = await read(async () => ({
      status: "observed",
      models: [{ value: "opus", name: "opus" }],
      via: "TEST_URL",
    }))();
    expect(out).toEqual({
      model: "opus",
      mode: "auto",
      configOptions: { effort: "high" },
      defaultModel: null,
      availableModels: [{ value: "opus", name: "opus" }],
    });
  });

  it("returns empty current values for a missing file but still discovers", async () => {
    const out = await read(async () => ({
      status: "observed",
      models: [{ value: "x", name: "x" }],
      via: "TEST_URL",
    }))();
    expect(out).toEqual({
      model: null,
      mode: null,
      configOptions: {},
      defaultModel: null,
      availableModels: [{ value: "x", name: "x" }],
    });
  });

  it("tolerates an unparseable file (empty current values)", async () => {
    writeFileSync(join(home, ".claude", "settings.json"), "{ not json");
    expect(await read(noDiscovery)()).toEqual({
      model: null,
      mode: null,
      configOptions: {},
      defaultModel: null,
      availableModels: null,
    });
  });

  // TEST_SCENARIO: Claude Code's catalog is its model tiers; a provider's listing adds to them rather than replacing them, so both stay pickable.
  it("lists the catalog's models ahead of discovered ones when the source extends the catalog", async () => {
    const out = await createHarnessConfigPlugin({
      harness: "test",
      binding: {
        ...BINDING,
        catalog: {
          options: [
            {
              id: "model",
              name: "Model",
              category: "model",
              choices: [{ value: "opus", name: "Opus" }],
            },
          ],
        },
        modelDiscovery: { urlEnv: ["U"], extendsCatalog: true },
      },
      agentHome: home,
      envReader: asLease({
        current: () => ({ U: "https://proxy" }),
        ready: () => true,
      }),
      discoverModels: async () => ({
        status: "observed",
        models: [
          { value: "opus", name: "opus" },
          { value: "claude/glm", name: "claude/glm" },
        ],
        via: "U",
      }),
      log: noop,
    }).readCurrent();
    expect(out.availableModels).toEqual([
      { value: "opus", name: "Opus" },
      { value: "claude/glm", name: "claude/glm" },
    ]);
  });

  // TEST_SCENARIO: a tier the provider serves no model of would be mapped onto another model by the harness's gateway, so the picker would promise a model it cannot deliver; only tiers the listing names stay.
  it("drops the catalog tiers the provider lists no model of", async () => {
    const out = await createHarnessConfigPlugin({
      harness: "test",
      binding: {
        ...BINDING,
        catalog: {
          options: [
            {
              id: "model",
              name: "Model",
              category: "model",
              choices: [
                { value: "sonnet", name: "Sonnet" },
                { value: "haiku", name: "Haiku" },
              ],
            },
          ],
        },
        modelDiscovery: { urlEnv: ["U"], extendsCatalog: true },
      },
      agentHome: home,
      envReader: asLease({
        current: () => ({ U: "https://proxy" }),
        ready: () => true,
      }),
      discoverModels: async () => ({
        status: "observed",
        models: [
          {
            value: "claude/aws/claude-sonnet-4-6",
            name: "claude/aws/claude-sonnet-4-6",
          },
        ],
        via: "U",
      }),
      log: noop,
    }).readCurrent();
    expect(out.availableModels?.map((m) => m.value)).toEqual([
      "sonnet",
      "claude/aws/claude-sonnet-4-6",
    ]);
  });

  // TEST_SCENARIO: before the env rail has materialized once, a missing URL says nothing about the grant, so the read must not clear an established list.
  it("omits the model list until the runtime env has materialized", async () => {
    const out = await createHarnessConfigPlugin({
      harness: "test",
      binding: { ...BINDING, modelDiscovery: { urlEnv: ["U"] } },
      agentHome: home,
      envReader: asLease({ current: () => ({}), ready: () => false }),
      discoverModels: noDiscovery,
      log: noop,
    }).readCurrent();
    expect(out).not.toHaveProperty("availableModels");
  });

  it("returns all-null when the harness declares no binding", async () => {
    const out = await createHarnessConfigPlugin({
      harness: "test",
      binding: undefined,
      agentHome: home,
      envReader: asLease(noEnv),
      discoverModels: noDiscovery,
      log: noop,
    }).readCurrent();
    expect(out).toEqual({
      model: null,
      mode: null,
      configOptions: {},
      defaultModel: null,
      availableModels: null,
    });
  });
});

describe("kept model listing", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hcl-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const listed = (...values: string[]) => ({
    status: "observed" as const,
    models: values.map((value) => ({ value, name: value })),
    via: "U",
  });
  const hung = () => new Promise<never>(() => {});

  const plugin = (
    discoverModels: ModelDiscovery,
    env: Record<string, string> = { U: "https://proxy" },
    onListingChanged?: () => void,
  ) =>
    createHarnessConfigPlugin({
      harness: "test",
      binding: { ...BINDING, modelDiscovery: { urlEnv: ["U"] } },
      agentHome: home,
      envReader: asLease({ current: () => env, ready: () => true }),
      discoverModels,
      onListingChanged,
      log: noop,
    });

  // TEST_SCENARIO: a provider listing can take seconds through the gateway; once one has answered, the picker and the defaults read answer from it at once and the list refreshes behind them.
  it("answers from the last listing while the provider is slow, then serves the refreshed one", async () => {
    let answer: (o: ReturnType<typeof listed>) => void = noop;
    const calls: number[] = [];
    const hc = plugin(async () => {
      calls.push(calls.length);
      return calls.length === 1
        ? listed("a")
        : new Promise((resolve) => (answer = resolve));
    });
    expect((await hc.readCurrent()).availableModels).toEqual(
      listed("a").models,
    );
    expect(await hc.models(null)).toEqual(listed("a").models);
    expect(calls).toHaveLength(2);
    answer(listed("b"));
    await new Promise((resolve) => setImmediate(resolve));
    expect(await hc.models(null)).toEqual(listed("b").models);
  });

  // TEST_SCENARIO: a picker already showing the kept listing learns that the refresh behind it found a different one, and only then; a first listing or an unchanged one answered the read itself.
  it("announces a refresh only when it changes a kept listing", async () => {
    const answers = [listed("a"), listed("a"), listed("b")];
    let changes = 0;
    const hc = plugin(
      async () => answers.shift() ?? listed("b"),
      undefined,
      () => changes++,
    );
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    await hc.models(null);
    expect(changes).toBe(0);
    expect(await hc.models(null)).toEqual(listed("a").models);
    await settle();
    expect(changes).toBe(0);
    expect(await hc.models(null)).toEqual(listed("a").models);
    await settle();
    expect(changes).toBe(1);
    expect(await hc.models(null)).toEqual(listed("b").models);
  });

  // TEST_SCENARIO: the kept listing survives a pod restart through the agent's home, so a woken agent's picker never waits on the provider either.
  it("answers from the listing a previous process kept on disk", async () => {
    await plugin(async () => listed("a")).models(null);
    expect(await plugin(hung).models(null)).toEqual(listed("a").models);
  });

  // TEST_SCENARIO: a provider that cannot be reached leaves the kept listing in place rather than emptying the picker.
  it("keeps the listing when a refresh is unavailable", async () => {
    const hc = plugin(async () => listed("a"));
    await hc.models(null);
    const failing = plugin(async () => ({ status: "unavailable" }));
    await failing.models(null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(await failing.models(null)).toEqual(listed("a").models);
  });

  // TEST_SCENARIO: a listing belongs to the provider endpoint that gave it; another endpoint's first read waits for its own listing rather than offering models it may not serve.
  it("never answers one endpoint from another endpoint's listing", async () => {
    await plugin(async () => listed("a")).models(null);
    expect(
      await plugin(async () => listed("b"), { U: "https://other" }).models(
        null,
      ),
    ).toEqual(listed("b").models);
  });
});
