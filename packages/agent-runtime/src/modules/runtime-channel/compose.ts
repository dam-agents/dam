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

export interface ComposeRuntimeChannelOpts {
  manifestPath: string;
  agentHome: string;
  apiServerUrl: string;
  agentId: string;
  triggerDriver: TriggerSessionDriver;
  plugins: readonly Plugin[];
  log?: (msg: string) => void;
}

export async function composeRuntimeChannel(
  opts: ComposeRuntimeChannelOpts,
): Promise<RuntimeChannelComposition> {
  const log = opts.log ?? ((m) => process.stderr.write(`[runtime] ${m}\n`));

  const manifest = loadManifest(opts.manifestPath);

  const stateStore = createStateStore(
    join(opts.agentHome, ".platform/runtime-state.json"),
  );
  const triggerStateStore = createTriggerStateStore(
    join(opts.agentHome, ".platform/trigger-state.json"),
  );

  const registry = createPluginRegistry();
  for (const plugin of opts.plugins) registry.register(plugin);
  const extensionLoader = createExtensionLoader();
  await extensionLoader.load(manifest.extensions?.impls ?? [], registry);

  const dispatcher = createDispatcher({
    manifest,
    registry,
    env: {
      agentHome: opts.agentHome,
      pluginStateRoot: join(opts.agentHome, ".platform/plugins"),
      log,
    },
  });

  const triggerImpl = createTriggerImpl({
    driver: opts.triggerDriver,
    stateStore: triggerStateStore,
  });

  const harnessClient: HarnessClient = createHarnessClient({
    apiServerUrl: opts.apiServerUrl,
    agentId: opts.agentId,
  });

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
