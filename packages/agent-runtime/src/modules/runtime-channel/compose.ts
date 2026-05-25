import { join } from "node:path";
import type {
  ContributionKind,
  EventKind,
  Plugin,
  RuntimeChannelService,
} from "agent-runtime-api";
import { loadManifest, type RuntimeManifest } from "./manifest.js";
import { createStateStore } from "./state-store.js";
import { createTriggerStateStore } from "./infrastructure/trigger-state-store.js";
import { createTriggerImpl } from "./drivers/trigger-impl.js";
import { createDispatcher } from "./dispatcher.js";
import { createPluginRegistry } from "./infrastructure/plugin-registry.js";
import { createExtensionLoader } from "./infrastructure/extension-loader.js";
import { createHarnessClient, type HarnessClient } from "./harness-client.js";
import { createRuntimeChannelService } from "./service.js";
import { runHello } from "./hello.js";
import type { TriggerSessionDriver } from "../acp/index.js";

export interface RuntimeChannelComposition {
  service: RuntimeChannelService;
  manifest: RuntimeManifest;
  helloOnBoot(opts: { agentRuntimeVersion: string }): Promise<void>;
}

/**
 * Composes the runtime channel module (ADR-052). The composer is
 * plugin-agnostic — it knows nothing about specific Contribution
 * kinds. Plugins (both the built-ins shipped with this package and
 * out-of-tree extensions declared in the manifest's `extensions.impls[]`)
 * are the only place Contribution-kind work lives.
 *
 * Boot sequence:
 *   1. Load + validate the runtime manifest.
 *   2. Register every plugin the caller provided in `plugins[]`.
 *      The caller is responsible for constructing built-in plugins
 *      with their deps wired (e.g. `createSkillInstallPlugin({ install })`).
 *   3. Resolve every `extensions.impls[]` via dynamic import and
 *      register the resulting plugins. Fail-fast on missing modules,
 *      version mismatch, or invalid plugin shape.
 *   4. Build the dispatcher against the manifest + registry. Each
 *      driver binding's impl is resolved by name; the plugin's `bind`
 *      method gets one chance per kind to produce a per-kind handler
 *      (and to validate its own binding config).
 *   5. Build the runtime-channel service (`runtime.v1.applyState`)
 *      against the dispatcher + trigger handler.
 *
 * Capability advertisement: `capabilities.contributions[]` is derived
 * from the manifest's `drivers` map. There is no separate capability
 * declaration; the bound kinds ARE the agent's capabilities.
 *
 * The caller invokes `helloOnBoot` after the HTTP server is listening —
 * the api-server's `hello` handler may immediately push a payload back
 * via this process's tRPC route.
 */
export interface ComposeRuntimeChannelOpts {
  manifestPath: string;
  agentHome: string;
  apiServerUrl: string;
  agentId: string;
  triggerDriver: TriggerSessionDriver;
  /** Plugins to register before extensions are loaded. The runtime
   *  channel module does not know anything specific to any of these —
   *  the caller decides which kinds the agent image supports by
   *  passing the corresponding plugins. */
  plugins: readonly Plugin[];
  log?: (msg: string) => void;
}

export async function composeRuntimeChannel(
  opts: ComposeRuntimeChannelOpts,
): Promise<RuntimeChannelComposition> {
  const log = opts.log ?? ((m) => process.stderr.write(`[runtime] ${m}\n`));

  const manifest = loadManifest(opts.manifestPath);

  // ── State stores
  const stateStore = createStateStore(
    join(opts.agentHome, ".platform/runtime-state.json"),
  );
  const triggerStateStore = createTriggerStateStore(
    join(opts.agentHome, ".platform/trigger-state.json"),
  );

  // ── Plugin registry: caller-supplied plugins first, extensions on top
  const registry = createPluginRegistry();
  for (const plugin of opts.plugins) registry.register(plugin);
  const extensionLoader = createExtensionLoader();
  await extensionLoader.load(manifest.extensions?.impls ?? [], registry);

  // ── Dispatcher: registry-driven, no kind switch
  const dispatcher = createDispatcher({
    manifest,
    registry,
    env: {
      agentHome: opts.agentHome,
      pluginStateRoot: join(opts.agentHome, ".platform/plugins"),
      log,
    },
  });

  // ── Trigger event handler (in-process; uses ACP via the trigger driver)
  const triggerImpl = createTriggerImpl({
    driver: opts.triggerDriver,
    stateStore: triggerStateStore,
  });

  // ── Hello-side harness client (used only for hello, not for event
  //    work — event handlers run agent-local).
  const harnessClient: HarnessClient = createHarnessClient({
    apiServerUrl: opts.apiServerUrl,
    agentId: opts.agentId,
  });

  // Capabilities derive from the manifest's bound kinds plus the
  // static set of event kinds the agent-runtime can handle.
  const contributionKinds = Object.keys(
    manifest.drivers,
  ) as readonly ContributionKind[];
  const eventKinds: readonly EventKind[] = ["trigger"];

  const service = createRuntimeChannelService({
    dispatcher,
    stateStore,
    triggerImpl,
    log,
  });

  return {
    service,
    manifest,
    async helloOnBoot({ agentRuntimeVersion }) {
      await runHello({
        client: harnessClient,
        stateStore,
        runtime: service,
        capabilities: {
          contributions: contributionKinds as never,
          events: eventKinds as never,
        },
        agentRuntimeVersion,
        log,
      });
    },
  };
}
