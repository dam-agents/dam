import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { watchHarnessCatalog } from "../../modules/model-catalog/index.js";
import { servedModels } from "../../modules/model-router/index.js";
import { createWorld } from "../../modules/acp/services/acp-runtime/__tests__/acp-world.js";
import { createHarnessConfigPlugin } from "../../modules/runtime-channel/drivers/harness-config-plugin.js";
import type { LeaseEnvReader } from "../../core/runtime-env.js";
import type { RuntimeEnvState } from "../../modules/runtime-channel/infrastructure/env-state-store.js";
import type { HarnessConfigBinding } from "../../modules/runtime-channel/manifest.js";
import {
  addTmpDir,
  BEDROCK,
  catalogOn,
  CURVE_BENDER,
  curveBender,
  HARNESSES,
  IBM,
  keptCatalogPath,
  removeKeptCatalogs,
  stateOf,
} from "./model-catalog-fixture.js";

function boot(opts: {
  cachePath: string;
  models: () => string[];
  state: () => RuntimeEnvState;
  held?: boolean;
  status?: () => "observed" | "unavailable";
  now?: () => Date;
}) {
  const { catalog, release } = catalogOn(opts);
  const world = createWorld({
    envReadyAtBoot: true,
    beforeSpawn: () => catalog.settled(),
  });
  watchHarnessCatalog({
    catalog,
    harnesses: Object.keys(HARNESSES),
    changed: () => world.runtime.refreshEnv({ force: false }),
  });
  return { catalog, world, release };
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
}

afterEach(() => {
  removeKeptCatalogs();
});

describe("the model catalog a boot starts from", () => {
  /**
   * TEST_SCENARIO: A wake. The machine last routed on Curve Bender's models
   * and kept them; this boot's listing cannot answer until the gateway pod is
   * up. The prestart at listen starts the default harness anyway, on the
   * models the cache holds, with no wait for the listing and no timeout.
   */
  it("starts the default harness at listen from the kept catalog", async () => {
    const cachePath = keptCatalogPath();
    const models = (): string[] => ["rits/zai-org/glm-5-3"];
    const state = stateOf(() => [CURVE_BENDER]);
    const first = boot({ cachePath, models, state });
    await first.catalog.refresh();
    expect(existsSync(cachePath)).toBe(true);

    const waking = boot({ cachePath, models, state, held: true });
    waking.world.runtime.prestart();
    await settle();
    expect(waking.world.harnessStarted()).toBe(true);
    expect(waking.catalog.entries().map((e) => e.name)).toEqual([
      "cb/rits/zai-org/glm-5-3",
    ]);
  });

  /**
   * TEST_SCENARIO: The harness writes its model windows from the catalog the
   * boot starts on, so the kept windows are what the process it starts reads,
   * not an empty file until the listing lands.
   */
  it("writes the kept catalog's model windows before the listing", async () => {
    const cachePath = keptCatalogPath();
    const models = (): string[] => ["house-model-1"];
    const state = stateOf(() => [CURVE_BENDER]);
    await boot({ cachePath, models, state }).catalog.refresh();

    const waking = boot({ cachePath, models, state, held: true });
    const home = mkdtempSync(join(tmpdir(), "model-catalog-home-"));
    addTmpDir(home);
    const binding: HarnessConfigBinding = {
      file: "$HOME/.claude/settings.json",
      format: "json",
      keys: { model: "model" },
      modelAutoCompactWindow: {
        keyPath: "modelContextWindows",
        field: "contextWindow",
        unknownWindow: 200_000,
      },
    };
    const env: LeaseEnvReader = {
      current: () => ({}),
      ready: () => true,
      providers: () => [],
      forLease: () => ({}),
    };
    const plugin = createHarnessConfigPlugin({
      harness: "claude-code",
      binding,
      agentHome: home,
      envReader: env,
      discoverModels: async () => ({ status: "not-configured" }),
      log: () => {},
    });

    await plugin.writeModelWindows(
      servedModels({
        harness: "claude-code",
        binding: HARNESSES["claude-code"]!,
        providers: waking.catalog.providers(),
      }),
    );
    const settings = JSON.parse(
      readFileSync(join(home, ".claude", "settings.json"), "utf8"),
    ) as { modelContextWindows?: Record<string, { contextWindow: number }> };
    expect(settings.modelContextWindows).toEqual({
      "claude/cb/house-model-1": { contextWindow: 256_000 },
    });
  });

  /**
   * TEST_SCENARIO: The rebuild after a wake lists exactly what the cache
   * holds. Everything already reads those models and the harness started on
   * them, so the catalog tells no listener and the process stays: a recycle
   * here would throw away the start the cache bought.
   */
  it("keeps the harness when the rebuild lists the kept catalog", async () => {
    const cachePath = keptCatalogPath();
    const models = (): string[] => ["rits/zai-org/glm-5-3"];
    const state = stateOf(() => [CURVE_BENDER]);
    await boot({ cachePath, models, state }).catalog.refresh();

    const waking = boot({ cachePath, models, state });
    let notices = 0;
    waking.catalog.onChange(() => {
      notices += 1;
    });
    waking.world.runtime.prestart();
    await settle();
    const harness = waking.world.harness();

    await waking.catalog.refresh();
    expect(notices).toBe(0);
    expect(waking.world.harness()).toBe(harness);
    expect(harness.killed()).toBe(false);
  });

  /**
   * TEST_SCENARIO: A wake where the gateway is not up yet: the rebuild cannot
   * list, so the Connection turns unavailable over the models the cache kept.
   * A reader shows that, but the harness reads the same models at the same
   * windows, so it is not recycled onto anything — the failure must not take
   * back the start the kept catalog bought, and the recovery must not recycle
   * a second time either.
   */
  it("keeps the harness when the rebuild cannot list a kept Connection", async () => {
    const cachePath = keptCatalogPath();
    const models = (): string[] => ["rits/zai-org/glm-5-3"];
    const state = stateOf(() => [CURVE_BENDER]);
    await boot({ cachePath, models, state }).catalog.refresh();

    let status: "observed" | "unavailable" = "unavailable";
    const waking = boot({ cachePath, models, state, status: () => status });
    waking.world.runtime.prestart();
    await settle();
    const harness = waking.world.harness();

    await waking.catalog.refresh();
    expect(waking.catalog.providers()[0]?.status).toBe("unavailable");
    expect(harness.killed()).toBe(false);
    expect(waking.world.harnessCount()).toBe(1);

    status = "observed";
    await waking.catalog.refresh();
    expect(waking.catalog.providers()[0]?.status).toBe("listed");
    expect(harness.killed()).toBe(false);
    expect(waking.world.harnessCount()).toBe(1);
  });

  /**
   * TEST_SCENARIO: The provider serves another model than the one the cache
   * holds. The harness was spawned with the kept list, so it is recycled onto
   * the new one rather than left offering a model its provider no longer
   * serves.
   */
  it("recycles the harness when the rebuild lists another model", async () => {
    const cachePath = keptCatalogPath();
    let models = ["rits/zai-org/glm-5-3"];
    const state = stateOf(() => [CURVE_BENDER]);
    await boot({ cachePath, models: () => models, state }).catalog.refresh();

    const waking = boot({ cachePath, models: () => models, state });
    waking.world.runtime.prestart();
    await settle();
    const harness = waking.world.harness();

    models = ["rits/zai-org/glm-5-3", "rits/nvidia/NVIDIA-Nemotron-3-Ultra"];
    await waking.catalog.refresh();
    expect(harness.killed()).toBe(true);
  });

  /**
   * TEST_SCENARIO: A new runtime's price table gives the same model ids other
   * windows than the kept list recorded. The harness would keep the restored
   * windows, which is the ceiling it compacts at, while the Model Router reads
   * the new ones, so the rebuild recycles it and the spawn writes the new
   * windows.
   */
  it("recycles the harness when the rebuild lists other windows for the same models", async () => {
    const cachePath = keptCatalogPath();
    const models = (): string[] => ["house-model-1"];
    await boot({
      cachePath,
      models,
      state: stateOf(() => [curveBender("256000")]),
    }).catalog.refresh();

    const waking = boot({
      cachePath,
      models,
      state: stateOf(() => [curveBender("128000")]),
    });
    waking.world.runtime.prestart();
    await settle();
    const harness = waking.world.harness();

    await waking.catalog.refresh();
    expect(harness.killed()).toBe(true);
  });

  /**
   * TEST_SCENARIO: A native Connection (Bedrock) is listed again on every
   * rebuild, so its listing carries a new time each time while its models are
   * the same ones the cache keeps. A time is no change a harness reads: the
   * process stays, and only a different model or window would take it down.
   */
  it("keeps the harness when a native listing is observed again", async () => {
    const cachePath = keptCatalogPath();
    const models = (): string[] => ["us.anthropic.claude-opus-5-5"];
    const state = stateOf(() => [BEDROCK]);
    await boot({
      cachePath,
      models,
      state,
      now: () => new Date(1_700_000_000_000),
    }).catalog.refresh();

    const waking = boot({
      cachePath,
      models,
      state,
      now: () => new Date(1_700_000_100_000),
    });
    let notices = 0;
    waking.catalog.onChange(() => {
      notices += 1;
    });
    waking.world.runtime.prestart();
    await settle();
    const harness = waking.world.harness();

    await waking.catalog.refresh();
    expect(
      waking.catalog
        .view("pi")
        .providers.find((p) => p.connectionId === "conn-bedrock")?.listedAt,
    ).toBe(new Date(1_700_000_100_000).toISOString());
    expect(notices).toBe(0);
    expect(harness.killed()).toBe(false);
    expect(waking.world.harnessCount()).toBe(1);
  });

  /**
   * TEST_SCENARIO: A Connection was revoked while the machine was down, so the
   * env rail no longer grants it. The cache still holds its models, but the
   * boot does not offer them: the harness starts on what the agent still has.
   */
  it("drops a Connection the env no longer grants before the harness starts", async () => {
    const cachePath = keptCatalogPath();
    const models = (): string[] => ["rits/zai-org/glm-5-3"];
    await boot({
      cachePath,
      models,
      state: stateOf(() => [CURVE_BENDER, IBM]),
    }).catalog.refresh();

    const waking = boot({
      cachePath,
      models,
      state: stateOf(() => [IBM]),
      held: true,
    });
    expect(waking.catalog.providers().map((p) => p.connectionId)).toEqual([
      "conn-ibm",
    ]);

    waking.world.runtime.prestart();
    await settle();
    expect(waking.world.harnessStarted()).toBe(true);
  });

  /**
   * TEST_SCENARIO: A changed provider reaches the boot's first state, which
   * recycles the prestarted harness and starts the catalog listing again. A
   * caller attaching in that second must not spawn on the list the change has
   * already invalidated: it waits for the listing and starts one harness, on
   * the settled catalog, rather than starting one the rebuild then recycles.
   */
  it("holds the spawn after an env change until the catalog it starts is settled", async () => {
    const cachePath = keptCatalogPath();
    let models = ["rits/zai-org/glm-5-3"];
    const state = stateOf(() => [CURVE_BENDER]);
    await boot({ cachePath, models: () => models, state }).catalog.refresh();

    const waking = boot({
      cachePath,
      models: () => models,
      state,
      held: true,
    });
    waking.world.runtime.prestart();
    await settle();
    expect(waking.world.harnessCount()).toBe(1);

    const refreshed = waking.catalog.refreshForEnvChange();
    waking.world.runtime.refreshEnv({ force: false });
    expect(waking.world.harness().killed()).toBe(true);

    models = ["rits/zai-org/glm-5-3", "rits/nvidia/NVIDIA-Nemotron-3-Ultra"];
    waking.world.connect();
    await settle();
    expect(waking.world.harnessCount()).toBe(1);

    waking.release();
    await refreshed;
    await settle();
    expect(waking.world.harnessCount()).toBe(2);
    expect(waking.world.harness().killed()).toBe(false);
  });

  /**
   * TEST_SCENARIO: A Connection revoked while the machine ran is dropped by
   * the rebuild, and the harness may not keep running on a provider the agent
   * no longer has.
   */
  it("recycles the harness when the rebuild finds a provider revoked", async () => {
    const cachePath = keptCatalogPath();
    let providers = [CURVE_BENDER];
    const models = (): string[] => ["rits/zai-org/glm-5-3"];
    const state = stateOf(() => providers);
    await boot({ cachePath, models, state }).catalog.refresh();

    const waking = boot({ cachePath, models, state });
    waking.world.runtime.prestart();
    await settle();
    const harness = waking.world.harness();

    providers = [];
    await waking.catalog.refresh();
    expect(waking.catalog.entries()).toEqual([]);
    expect(harness.killed()).toBe(true);
  });

  /**
   * TEST_SCENARIO: A create has no kept catalog, so there is nothing to start
   * the harness on: the prestart waits for the first listing exactly as it
   * does today, and starts the moment that listing lands.
   */
  it("waits for the first listing when no catalog was kept", async () => {
    const cachePath = keptCatalogPath();
    const models = (): string[] => ["rits/zai-org/glm-5-3"];
    const state = stateOf(() => [CURVE_BENDER]);
    const waking = boot({ cachePath, models, state, held: true });

    waking.world.runtime.prestart();
    await settle();
    expect(waking.world.harnessStarted()).toBe(false);

    waking.release();
    await waking.catalog.refresh();
    await settle();
    expect(waking.world.harnessStarted()).toBe(true);
  });

  /**
   * TEST_SCENARIO: The runtime that boots the machine passes the cache path.
   * `server.ts` starts listeners and spawns at import, so it has no seam to
   * import in a test; this reads the wiring it ships with, because a boot that
   * neither writes nor reads the kept catalog silently loses the start it
   * buys, and nothing else in the suite would notice.
   */
  it("is wired to the agent's home volume by the runtime", () => {
    const server = readFileSync(
      new URL("../../server.ts", import.meta.url),
      "utf8",
    );
    expect(server).toMatch(/cachePath:\s*modelCatalogCachePath\(homeDir\)/);
  });
});
