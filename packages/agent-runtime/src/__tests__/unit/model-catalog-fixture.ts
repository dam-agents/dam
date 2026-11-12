/**
 * TEST_OVERVIEW: catalog doubles shared by the specs about the catalog a boot
 * starts from: the harness bindings and provider Connections they list, a
 * discovery that answers on demand or hangs, and a catalog wired to a cache
 * path in a temporary directory, so a spec can write a kept catalog with one
 * boot and start from it with the next.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createModelCatalog,
  modelCatalogCachePath,
  type ModelCatalog,
  VENDORED_PRICE_TABLE,
} from "../../modules/model-catalog/index.js";
import type { ModelDiscovery } from "../../modules/runtime-channel/infrastructure/model-discovery.js";
import type { RuntimeEnvState } from "../../modules/runtime-channel/infrastructure/env-state-store.js";
import type { ModelRouterBinding } from "../../modules/runtime-channel/manifest.js";

export const HARNESSES: Record<string, ModelRouterBinding | undefined> = {
  "claude-code": {
    dialects: ["anthropic-messages"],
    namePrefix: "claude/",
    lowercaseNames: true,
    native: { templates: ["bedrock"], models: ["opus", "sonnet"] },
  },
  pi: {
    dialects: ["anthropic-messages", "openai-chat", "openai-responses"],
    native: { templates: ["bedrock"], models: "listed" },
  },
};

export const curveBender = (contextWindow: string) => ({
  id: "conn-cb",
  template: "curve-bender",
  env: {
    OPENAI_BASE_URL: "https://cb.example",
    OPENAI_API_KEY: "platform:conn:conn-cb",
    OPENAI_PROXY_CONTEXT_WINDOW: contextWindow,
  },
});

export const CURVE_BENDER = curveBender("256000");

export const IBM = {
  id: "conn-ibm",
  template: "ibm-litellm",
  env: {
    OPENAI_BASE_URL: "https://ibm.example",
    OPENAI_API_KEY: "platform:conn:conn-ibm",
    OPENAI_PROXY_CONTEXT_WINDOW: "200000",
  },
};

export const BEDROCK = {
  id: "conn-bedrock",
  template: "bedrock",
  env: {
    AWS_BEARER_TOKEN_BEDROCK: "platform:conn:conn-bedrock",
    AWS_ENDPOINT_URL_BEDROCK: "https://bedrock.example",
  },
};

export const stateOf =
  (providers: () => RuntimeEnvState["providers"]) => (): RuntimeEnvState => ({
    env: {},
    providers: providers(),
    harnesses: [],
  });

export function discoveryOf(
  models: () => string[],
  opts: { held?: boolean; status?: () => "observed" | "unavailable" } = {},
): { discover: ModelDiscovery; release: () => void } {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const discover = (async () => {
    if (opts.held) await gate;
    if (opts.status?.() === "unavailable")
      return { status: "unavailable" as const };
    const entries = models().map((id) => ({ id, name: id }));
    return {
      status: "observed" as const,
      models: entries.map((e) => ({ value: e.id, name: e.name })),
      entries,
      via: "test",
    };
  }) as ModelDiscovery;
  return { discover, release };
}

export function catalogOn(opts: {
  cachePath: string;
  models: () => string[];
  state: () => RuntimeEnvState;
  held?: boolean;
  status?: () => "observed" | "unavailable";
  now?: () => Date;
}): { catalog: ModelCatalog; release: () => void } {
  const { discover, release } = discoveryOf(opts.models, {
    ...(opts.held !== undefined && { held: opts.held }),
    ...(opts.status !== undefined && { status: opts.status }),
  });
  const catalog = createModelCatalog({
    envState: opts.state,
    envReady: () => true,
    discover,
    harnesses: HARNESSES,
    table: VENDORED_PRICE_TABLE,
    log: () => {},
    cachePath: opts.cachePath,
    ...(opts.now !== undefined && { now: opts.now }),
  });
  return { catalog, release };
}

const dirs: string[] = [];

export function keptCatalogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "model-catalog-"));
  dirs.push(dir);
  return modelCatalogCachePath(dir);
}

export function addTmpDir(dir: string): void {
  dirs.push(dir);
}

export function removeKeptCatalogs(): void {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
}
