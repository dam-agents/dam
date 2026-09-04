import { join } from "node:path";
import { eventKind } from "agent-runtime-api";
import type {
  ContributionKind,
  HarnessConfigService,
  Plugin,
  RuntimeChannelService,
  SessionDirectoryEntry,
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
import { createWorkspaceCommandPlugin } from "./drivers/workspace-command-plugin.js";
import { createExperimentExecutePlugin } from "./drivers/experiment-execute-plugin.js";
import { createDispatcher, type ContextEnv } from "./dispatcher.js";
import { createEventDispatcher } from "./event-dispatcher.js";
import { createPluginRegistry } from "./infrastructure/plugin-registry.js";
import { createExtensionLoader } from "./infrastructure/extension-loader.js";
import { createHarnessClient, type HarnessClient } from "./harness-client.js";
import { createRuntimeChannelService } from "./service.js";
import { createHarnessConfigPlugin } from "./drivers/harness-config-plugin.js";
import { createModelDiscovery } from "./infrastructure/model-discovery.js";
import { runHello } from "./hello.js";
import {
  createSessionDirectoryReporter,
  type SessionDirectoryReporter,
} from "./session-directory-report.js";
import type { TriggerSessionDriver } from "../acp/index.js";

const SESSION_DIRECTORY_DEBOUNCE_MS = 1_000;

export interface RuntimeChannelComposition {
  service: RuntimeChannelService;
  manifest: RuntimeManifest;
  harnessConfig: HarnessConfigService;
  sessionDirectory: SessionDirectoryReporter;
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
  readSessions: () => readonly SessionDirectoryEntry[];
  plugins: readonly Plugin[];
  envReader: RuntimeEnvReader;
  log?: (msg: string) => void;
}

export async function composeRuntimeChannel(
  opts: ComposeRuntimeChannelOpts,
): Promise<RuntimeChannelComposition> {
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
    createWorkspaceCommandPlugin({ workDir: opts.workDir, log }),
  );
  registry.register(
    createExperimentExecutePlugin({ driver: opts.triggerDriver }),
  );

  const harnessConfigRaw = resolved["harness-config"];
  const harnessConfigPlugin = createHarnessConfigPlugin({
    binding: harnessConfigRaw
      ? harnessConfigBinding.parse(harnessConfigRaw)
      : undefined,
    agentHome: opts.agentHome,
    envReader: opts.envReader,
    discoverModels: createModelDiscovery({ log }),
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
  const eventKinds = eventKind.options;

  const service = createRuntimeChannelService({
    dispatcher,
    eventDispatcher,
    stateStore,
    readHarnessConfig: async () =>
      harnessConfigPlugin.supported
        ? await harnessConfigPlugin.readCurrent()
        : undefined,
    log,
  });

  const sessionDirectory = createSessionDirectoryReporter({
    client: harnessClient,
    readSessions: opts.readSessions,
    debounceMs: SESSION_DIRECTORY_DEBOUNCE_MS,
    log,
  });

  return {
    service,
    manifest,
    harnessConfig: harnessConfigPlugin,
    sessionDirectory,
    async helloOnBoot({ agentRuntimeVersion }) {
      const capabilities = {
        contributions: contributionKinds as never,
        events: eventKinds as never,
        harnessConfig: harnessConfigPlugin.supported,
        harnessConfigCatalog: harnessConfigPlugin.catalog,
        kbPublish: 2,
        liveUpdates: true,
      };
      for (let delay = 1_000; ; delay = Math.min(delay * 2, 30_000)) {
        if (
          await runHello({
            client: harnessClient,
            stateStore,
            capabilities,
            agentRuntimeVersion,
            harnessConfigCurrent: harnessConfigPlugin.supported
              ? await harnessConfigPlugin.readCurrent({ discover: false })
              : undefined,
            log,
          })
        ) {
          sessionDirectory.report();
          return;
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    },
  };
}
