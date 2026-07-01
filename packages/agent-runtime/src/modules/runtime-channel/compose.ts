import { join } from "node:path";
import { eventKind } from "agent-runtime-api";
import type {
  ContributionKind,
  HarnessConfigService,
  Plugin,
  RuntimeChannelService,
} from "agent-runtime-api";
import type { DocumentStoreBackend } from "../../core/document-store.js";
import type { RuntimeEnvReader } from "../../core/runtime-env.js";
import {
  contributionDrivers,
  eventDrivers,
  harnessConfigBinding,
  loadManifest,
  resolveDrivers,
  type RuntimeManifest,
} from "./manifest.js";
import { createStateStore } from "./state-store.js";
import { createTriggerStateStore } from "./infrastructure/trigger-state-store.js";
import { createTriggerPlugin } from "./drivers/trigger-plugin.js";
import { createWorkspaceSeedPlugin } from "./drivers/workspace-seed-plugin.js";
import { createExperimentTriggerPlugin } from "./drivers/experiment-trigger-plugin.js";
import { createDispatcher, type ContextEnv } from "./dispatcher.js";
import { createEventDispatcher } from "./event-dispatcher.js";
import { createPluginRegistry } from "./infrastructure/plugin-registry.js";
import { createExtensionLoader } from "./infrastructure/extension-loader.js";
import { createHarnessClient, type HarnessClient } from "./harness-client.js";
import { createRuntimeChannelService } from "./service.js";
import { createHarnessConfigPlugin } from "./drivers/harness-config-plugin.js";
import { createOpenAiModelDiscovery } from "./infrastructure/model-discovery.js";
import { runHello } from "./hello.js";
import type { TriggerSessionDriver } from "../acp/index.js";

export interface RuntimeChannelComposition {
  service: RuntimeChannelService;
  manifest: RuntimeManifest;
  harnessConfig: HarnessConfigService;
  helloOnBoot(opts: { agentRuntimeVersion: string }): Promise<void>;
}

export interface ComposeRuntimeChannelOpts {
  manifestPath: string;
  agentHome: string;
  workDir: string;
  stateBackend: DocumentStoreBackend;
  apiServerUrl: string;
  agentId: string;
  triggerDriver: TriggerSessionDriver;
  plugins: readonly Plugin[];
  envReader: RuntimeEnvReader;
  log?: (msg: string) => void;
}

export async function composeRuntimeChannel(
  opts: ComposeRuntimeChannelOpts,
): Promise<RuntimeChannelComposition> {
  // Timestamp the boot timeline so it's diagnosable (#695).
  const log =
    opts.log ??
    ((m) =>
      process.stderr.write(`${new Date().toISOString()} [runtime] ${m}\n`));

  const manifest = loadManifest(opts.manifestPath);

  const stateStore = createStateStore(opts.stateBackend);
  const triggerStateStore = createTriggerStateStore(
    join(opts.agentHome, ".platform", "trigger"),
  );

  const resolved = resolveDrivers(manifest);
  const env: ContextEnv = {
    agentHome: opts.agentHome,
    pluginStateRoot: join(opts.agentHome, ".platform/plugins"),
    log,
  };

  const registry = createPluginRegistry();
  for (const plugin of opts.plugins) registry.register(plugin);
  registry.register(
    createTriggerPlugin({
      driver: opts.triggerDriver,
      stateStore: triggerStateStore,
    }),
  );
  registry.register(createWorkspaceSeedPlugin({ workDir: opts.workDir, log }));
  registry.register(
    createExperimentTriggerPlugin({ driver: opts.triggerDriver }),
  );

  const harnessConfigRaw = resolved["harness-config"];
  const harnessConfigPlugin = createHarnessConfigPlugin({
    binding: harnessConfigRaw
      ? harnessConfigBinding.parse(harnessConfigRaw)
      : undefined,
    agentHome: opts.agentHome,
    envReader: opts.envReader,
    discoverModels: createOpenAiModelDiscovery({ log }),
    log,
  });
  if (harnessConfigPlugin.supported) registry.register(harnessConfigPlugin);

  const extensionLoader = createExtensionLoader();
  await extensionLoader.load(manifest.extensions?.impls ?? [], registry);

  const dispatcher = createDispatcher({
    drivers: contributionDrivers(resolved),
    registry,
    env,
  });
  const eventDispatcher = createEventDispatcher({
    drivers: eventDrivers(resolved),
    registry,
    env,
  });

  const harnessClient: HarnessClient = createHarnessClient({
    apiServerUrl: opts.apiServerUrl,
    agentId: opts.agentId,
  });

  const contributionKinds = Object.keys(
    contributionDrivers(resolved),
  ) as readonly ContributionKind[];
  // A kind with no active driver no-ops at dispatch, so advertise the whole set.
  const eventKinds = eventKind.options;

  const service = createRuntimeChannelService({
    dispatcher,
    eventDispatcher,
    stateStore,
    log,
  });

  return {
    service,
    manifest,
    harnessConfig: harnessConfigPlugin,
    async helloOnBoot({ agentRuntimeVersion }) {
      const capabilities = {
        contributions: contributionKinds as never,
        events: eventKinds as never,
        harnessConfig: harnessConfigPlugin.supported,
        harnessConfigCatalog: harnessConfigPlugin.catalog,
      };
      // Retry until it lands: the harness path can be unconverged at boot and readiness hard-depends on hello.
      for (let delay = 1_000; ; delay = Math.min(delay * 2, 30_000)) {
        if (
          await runHello({
            client: harnessClient,
            stateStore,
            capabilities,
            agentRuntimeVersion,
            log,
          })
        )
          return;
        await new Promise((r) => setTimeout(r, delay));
      }
    },
  };
}
