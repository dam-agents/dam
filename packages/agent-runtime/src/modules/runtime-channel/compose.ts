import { join } from "node:path";
import { eventKind } from "agent-runtime-api";
import type {
  EventReportInput,
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
  resolveDrivers,
  type RuntimeManifest,
} from "./manifest.js";
import { createStateStore } from "./state-store.js";
import type { ApplyStateDeps } from "./service.js";
import { createTriggerStateStore } from "./infrastructure/trigger-state-store.js";
import { createTriggerPlugin } from "./drivers/trigger-plugin.js";
import { createPrecheckRunner } from "./infrastructure/precheck-runner.js";
import { createWorkspaceSeedPlugin } from "./drivers/workspace-seed-plugin.js";
import { createWorkspaceCommandPlugin } from "./drivers/workspace-command-plugin.js";
import {
  createExperimentExecutePlugin,
  createInitializationPlugin,
  createSatelliteOutcomePlugin,
} from "./drivers/session-event-plugins.js";
import {
  createDispatcher,
  createEventDispatcher,
  type ContextEnv,
} from "./dispatcher.js";
import { createPluginRegistry } from "./infrastructure/plugin-registry.js";
import { loadExtensions } from "./infrastructure/extension-loader.js";
import type { HarnessClient } from "./harness-client.js";
import { createRuntimeChannelService } from "./service.js";
import { createHarnessConfigPlugin } from "./drivers/harness-config-plugin.js";
import { createModelDiscovery } from "./infrastructure/model-discovery.js";
import {
  createSessionDirectoryReporter,
  type SessionDirectoryReporter,
} from "./session-directory-report.js";
import type { TriggerSessionDriver } from "../acp/index.js";

const SESSION_DIRECTORY_DEBOUNCE_MS = 1_000;

export function pluginStateRoot(agentHome: string): string {
  return join(agentHome, ".platform/plugins");
}

export interface RuntimeChannelComposition {
  service: RuntimeChannelService;
  harnessConfig: HarnessConfigService;
  seedHarnessModel(): Promise<boolean>;
  sessionDirectory: SessionDirectoryReporter;
  helloOnBoot(opts: { agentRuntimeVersion: string }): Promise<void>;
}

export interface ComposeRuntimeChannelOpts {
  onHarnessConfigApplied: () => void;
  manifest: RuntimeManifest;
  agentHome: string;
  workDir: string;
  stateBackend: DocumentStoreBackend;
  harnessClient: HarnessClient;
  triggerDriver: TriggerSessionDriver;
  readSessions: () => readonly SessionDirectoryEntry[];
  plugins: readonly Plugin[];
  envReader: RuntimeEnvReader;
  onSnapshotProcessed?: ApplyStateDeps["onSnapshotProcessed"];
  log?: (msg: string) => void;
}

export async function composeRuntimeChannel(
  opts: ComposeRuntimeChannelOpts,
): Promise<RuntimeChannelComposition> {
  const log =
    opts.log ??
    ((m) =>
      process.stderr.write(`${new Date().toISOString()} [runtime] ${m}\n`));

  const { manifest, harnessClient } = opts;
  const stateStore = createStateStore(opts.stateBackend);
  const triggerStateStore = createTriggerStateStore(
    join(opts.agentHome, ".platform", "trigger"),
  );

  const resolved = resolveDrivers(manifest);
  const env: ContextEnv = {
    agentHome: opts.agentHome,
    pluginStateRoot: pluginStateRoot(opts.agentHome),
    log,
  };

  const reporter = {
    report: (input: EventReportInput) =>
      harnessClient.runtime.v1.reportEvent.mutate(input) as Promise<void>,
  };
  const registry = createPluginRegistry();
  for (const plugin of opts.plugins) registry.register(plugin);
  registry.register(
    createTriggerPlugin({
      driver: opts.triggerDriver,
      stateStore: triggerStateStore,
      runPrecheck: createPrecheckRunner({
        workDir: opts.workDir,
        envReader: opts.envReader,
      }),
      log,
      reporter,
    }),
  );
  registry.register(createWorkspaceSeedPlugin({ workDir: opts.workDir, log }));
  registry.register(
    createWorkspaceCommandPlugin({ workDir: opts.workDir, log }),
  );
  registry.register(
    createExperimentExecutePlugin({ driver: opts.triggerDriver }),
  );
  registry.register(createInitializationPlugin({ driver: opts.triggerDriver }));
  registry.register(
    createSatelliteOutcomePlugin({ driver: opts.triggerDriver }),
  );

  const harnessConfigRaw = resolved["harness-config"];
  const harnessConfigPlugin = createHarnessConfigPlugin({
    onApplied: opts.onHarnessConfigApplied,
    binding: harnessConfigRaw
      ? harnessConfigBinding.parse(harnessConfigRaw)
      : undefined,
    agentHome: opts.agentHome,
    envReader: opts.envReader,
    discoverModels: createModelDiscovery({ log }),
    log,
  });
  if (harnessConfigPlugin.supported) registry.register(harnessConfigPlugin);

  await loadExtensions(manifest.extensions?.impls ?? [], registry);

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

  const contributionKinds = Object.keys(
    contributionDrivers(resolved),
  ) as readonly ContributionKind[];
  const eventKinds = eventKind.options;

  const service = createRuntimeChannelService({
    dispatcher,
    eventDispatcher,
    stateStore,
    reporter,
    readHarnessConfig: async () =>
      harnessConfigPlugin.supported
        ? await harnessConfigPlugin.readCurrent()
        : undefined,
    ...(opts.onSnapshotProcessed
      ? { onSnapshotProcessed: opts.onSnapshotProcessed }
      : {}),
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
    harnessConfig: harnessConfigPlugin,
    seedHarnessModel: harnessConfigPlugin.seedModel,
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
        const harnessConfigCurrent = harnessConfigPlugin.supported
          ? await harnessConfigPlugin.readCurrent({ discover: false })
          : undefined;
        const local = stateStore.read();
        log(
          `[runtime] hello → local v=${local.lastAppliedVersion} hash=${(local.lastAppliedHash ?? "<none>").slice(0, 8)} capabilities={contributions:${contributionKinds.join("|")}, events:${eventKinds.join("|")}}`,
        );
        try {
          await harnessClient.runtime.v1.hello.mutate({
            lastAppliedVersion: local.lastAppliedVersion || undefined,
            lastAppliedHash: local.lastAppliedHash ?? undefined,
            protocolVersion: "v1",
            agentRuntimeVersion,
            capabilities,
            harnessConfigCurrent,
          });
          sessionDirectory.report();
          return;
        } catch (err) {
          log(`[runtime] hello failed: ${(err as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    },
  };
}
