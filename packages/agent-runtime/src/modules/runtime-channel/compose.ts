import { join } from "node:path";
import {
  eventKind,
  sessionDefaultsEventPayload,
  startupItemsEventPayload,
} from "agent-runtime-api";
import type {
  EventReportInput,
  ContributionKind,
  HarnessConfigCurrent,
  HarnessConfigService,
  Plugin,
  RuntimeChannelService,
  SessionDefaultsEventPayload,
  SessionDirectoryEntry,
  StartupItemsEventPayload,
} from "agent-runtime-api";
import type { DocumentStoreBackend } from "../../core/document-store.js";
import { noticeStream } from "../../core/notice-stream.js";
import { mergedSpawnEnv, type LeaseEnvReader } from "../../core/runtime-env.js";
import {
  contributionDrivers,
  eventDrivers,
  harnessConfigBinding,
  resolveDrivers,
  type RuntimeManifest,
} from "./manifest.js";
import { createStateStore } from "./state-store.js";
import { bindingsFingerprint } from "./domain/bindings-fingerprint.js";
import type { ApplyStateDeps } from "./service.js";
import {
  createTriggerStateStore,
  type TriggerStateStore,
} from "./infrastructure/trigger-state-store.js";
import { createTriggerPlugin } from "./drivers/trigger-plugin.js";
import { createSessionMessagePlugin } from "./drivers/session-message-plugin.js";
import { createPrecheckRunner } from "./infrastructure/precheck-runner.js";
import { createWorkspaceSeedPlugin } from "./drivers/workspace-seed-plugin.js";
import { createWorkspaceCommandPlugin } from "./drivers/workspace-command-plugin.js";
import { createAgentInstructionsPlugin } from "./drivers/agent-instructions-plugin.js";
import {
  createInitializationPlugin,
  createSubAgentOutcomePlugin,
  createSatelliteOutcomePlugin,
} from "./drivers/session-event-plugins.js";
import {
  createDispatcher,
  createEventDispatcher,
  type ContextEnv,
  type ScopedBinding,
} from "./dispatcher.js";
import {
  createPluginRegistry,
  eventPlugin,
} from "./infrastructure/plugin-registry.js";
import { loadExtensions } from "./infrastructure/extension-loader.js";
import type { HarnessClient } from "./harness-client.js";
import type { InvocationWatch } from "./services/invocation-watch.js";
import { createRuntimeChannelService } from "./service.js";
import {
  createHarnessConfigPlugin,
  type HarnessConfigPlugin,
} from "./drivers/harness-config-plugin.js";
import { createModelDiscovery } from "./infrastructure/model-discovery.js";
import { catalogChoices } from "./domain/catalog-choices.js";
import type { ModelCatalog } from "../model-catalog/index.js";
import { servedModels } from "../model-router/index.js";
import {
  createSessionDirectoryReporter,
  type SessionDirectoryReporter,
} from "./session-directory-report.js";
import type {
  TriggerSessionDriver,
  SubAgentSessionStore,
} from "../acp/index.js";

const SESSION_DIRECTORY_DEBOUNCE_MS = 1_000;

export function pluginStateRoot(agentHome: string): string {
  return join(agentHome, ".platform/plugins");
}

export interface RuntimeChannelComposition {
  service: RuntimeChannelService;
  harnessConfig: HarnessConfigService;
  writeModelWindows(): Promise<void>;
  sessionDirectory: SessionDirectoryReporter;
  triggerStateStore: TriggerStateStore;
  helloOnBoot(opts: { agentRuntimeVersion: string }): Promise<void>;
}

export interface ComposeRuntimeChannelOpts {
  onHarnessConfigApplied: (harness: string) => void;
  manifests: Readonly<Record<string, RuntimeManifest>>;
  defaultHarness: string;
  agentHome: string;
  workDir: string;
  stateBackend: DocumentStoreBackend;
  harnessClient: HarnessClient;
  triggerDriver: TriggerSessionDriver;
  invocationWatch: Pick<InvocationWatch, "watch">;
  subAgentSessions: SubAgentSessionStore;
  onSessionDefaults: (defaults: SessionDefaultsEventPayload) => void;
  onStartupItems: (payload: StartupItemsEventPayload) => Promise<void>;
  findSessionByRef?: (ref: string) => string | undefined;
  recordContinuation?: (sessionId: string, scheduleId: string) => void;
  readSessions: () => readonly SessionDirectoryEntry[];
  plugins: readonly Plugin[];
  envReader: LeaseEnvReader;
  envStale?: () => string | undefined;
  catalog?: ModelCatalog;
  modelRouter?: boolean;
  onContributionsApplied?: ApplyStateDeps["onContributionsApplied"];
  onSnapshotProcessed?: ApplyStateDeps["onSnapshotProcessed"];
}

export async function composeRuntimeChannel(
  opts: ComposeRuntimeChannelOpts,
): Promise<RuntimeChannelComposition> {
  const log = (m: string): void => {
    process.stderr.write(`${new Date().toISOString()} [runtime] ${m}\n`);
  };

  const { harnessClient, defaultHarness } = opts;
  const manifest = opts.manifests[defaultHarness]!;
  const resolvedByHarness = Object.entries(opts.manifests)
    .sort(
      ([a], [b]) => Number(b === defaultHarness) - Number(a === defaultHarness),
    )
    .map(([harness, m]) => ({ harness, resolved: resolveDrivers(m) }));
  const resolved = resolvedByHarness[0]!.resolved;
  const contributionBindings: Record<string, ScopedBinding[]> = {};
  for (const { harness, resolved: own } of resolvedByHarness) {
    for (const [kind, binding] of Object.entries(contributionDrivers(own))) {
      const list = (contributionBindings[kind] ??= []);
      const same = bindingsFingerprint({ binding });
      if (
        list.some((b) => bindingsFingerprint({ binding: b.binding }) === same)
      )
        continue;
      list.push({
        binding,
        scope: harness === defaultHarness ? null : harness,
      });
    }
  }
  const stateStore = createStateStore(opts.stateBackend, {
    envReady: opts.envReader.ready,
    ...(opts.envStale && { envStale: opts.envStale }),
    bindingsFingerprint: bindingsFingerprint(
      Object.fromEntries(
        Object.entries(contributionBindings).map(([kind, list]) => [
          kind,
          list.length === 1 && list[0]!.scope === null
            ? list[0]!.binding
            : list,
        ]),
      ),
    ),
    log,
  });
  const triggerStateStore = createTriggerStateStore(
    join(opts.agentHome, ".platform", "trigger"),
  );

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
      ...(opts.findSessionByRef
        ? { findSessionByRef: opts.findSessionByRef }
        : {}),
      ...(opts.recordContinuation
        ? { recordContinuation: opts.recordContinuation }
        : {}),
      ...(opts.catalog ? { catalogListed: () => opts.catalog!.listed() } : {}),
      invocationWatch: opts.invocationWatch,
    }),
  );
  const spawnEnv = () => mergedSpawnEnv(opts.envReader);
  registry.register(
    createWorkspaceSeedPlugin({ workDir: opts.workDir, spawnEnv, log }),
  );
  registry.register(
    createWorkspaceCommandPlugin({ workDir: opts.workDir, spawnEnv, log }),
  );

  registry.register(createAgentInstructionsPlugin({ log }));
  registry.register(createInitializationPlugin({ driver: opts.triggerDriver }));
  registry.register(
    eventPlugin("session-defaults", "session-defaults", async (payload) =>
      opts.onSessionDefaults(sessionDefaultsEventPayload.parse(payload)),
    ),
  );
  registry.register(
    eventPlugin("startup-items", "startup-items", async (payload) =>
      opts.onStartupItems(startupItemsEventPayload.parse(payload)),
    ),
  );
  registry.register(
    createSatelliteOutcomePlugin({ driver: opts.triggerDriver }),
  );
  registry.register(
    createSubAgentOutcomePlugin({
      driver: opts.triggerDriver,
      sessions: opts.subAgentSessions,
    }),
  );
  registry.register(
    createSessionMessagePlugin({ driver: opts.triggerDriver, reporter, log }),
  );

  const discoverModels = createModelDiscovery({ log });
  const harnessConfigs = new Map<string, HarnessConfigPlugin>();
  const listingWatchers = new Set<() => void>();
  for (const { harness, resolved: own } of resolvedByHarness) {
    const raw = own["harness-config"];
    if (!raw) continue;
    harnessConfigs.set(
      harness,
      createHarnessConfigPlugin({
        harness,
        onApplied: () => opts.onHarnessConfigApplied(harness),
        onListingChanged: () => {
          for (const watcher of listingWatchers) watcher();
        },
        binding: harnessConfigBinding.parse(raw),
        agentHome: opts.agentHome,
        envReader: opts.envReader,
        discoverModels,
        ...(opts.catalog &&
          opts.manifests[harness]?.modelRouter && {
            catalogModels: () => catalogChoices(opts.catalog!.view(harness)),
          }),
        log,
      }),
    );
  }
  opts.catalog?.onChange(() => {
    for (const watcher of listingWatchers) watcher();
  });
  const harnessConfigPlugin = harnessConfigs.get(defaultHarness);
  const harnessConfigFor = (harness: string | undefined) =>
    harnessConfigs.get(harness ?? defaultHarness);
  if (harnessConfigs.size > 0)
    registry.register({
      name: "harness-config",
      bindEvent: () => async (payload) => {
        const { harness } = payload as { harness?: string };
        const target = harnessConfigFor(harness);
        if (!target)
          throw new Error(
            `harness ${harness ?? defaultHarness} has no harness-config driver`,
          );
        await target.apply(payload as never);
      },
    });
  const eventBindings = {
    ...eventDrivers(resolved),
    ...(harnessConfigs.size > 0 && {
      "harness-config": { impl: "harness-config" },
    }),
  };
  const harnessConfigByHarness = async (): Promise<
    Record<string, HarnessConfigCurrent>
  > =>
    Object.fromEntries(
      await Promise.all(
        [...harnessConfigs].map(
          async ([harness, plugin]) =>
            [harness, await plugin.readCurrent({ discover: false })] as const,
        ),
      ),
    );

  await loadExtensions(manifest.extensions?.impls ?? [], registry);

  const dispatcher = createDispatcher({
    drivers: contributionBindings,
    registry,
    env,
  });
  const eventDispatcher = createEventDispatcher({
    drivers: eventBindings,
    registry,
    env,
  });

  const contributionKinds = Object.keys(
    contributionBindings,
  ) as readonly ContributionKind[];
  const eventKinds = eventKind.options;

  const service = createRuntimeChannelService({
    dispatcher,
    eventDispatcher,
    stateStore,
    reporter,
    readHarnessConfig: async () => ({
      ...(harnessConfigPlugin && {
        harnessConfigCurrent: await harnessConfigPlugin.readCurrent(),
      }),
      ...(harnessConfigs.size > 0 && {
        harnessConfigCurrentByHarness: await harnessConfigByHarness(),
      }),
    }),
    ...(opts.onContributionsApplied
      ? { onContributionsApplied: opts.onContributionsApplied }
      : {}),
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

  const writtenWindows = new Map<string, string>();
  const writeModelWindows = async (): Promise<void> => {
    if (!opts.catalog) return;
    for (const [harness, plugin] of harnessConfigs) {
      const binding = opts.manifests[harness]?.modelRouter;
      if (!binding) continue;
      const models = servedModels({
        harness,
        binding,
        providers: opts.catalog.providers(),
      });
      const fingerprint = JSON.stringify(models);
      if (writtenWindows.get(harness) === fingerprint) continue;
      try {
        await plugin.writeModelWindows(models);
        writtenWindows.set(harness, fingerprint);
      } catch (err) {
        log(
          `[harness-config] model windows not written: ${(err as Error).message}`,
        );
      }
    }
  };

  return {
    service,
    writeModelWindows,
    harnessConfig: {
      readCurrent: async (input) => {
        const target = harnessConfigFor(input?.harness);
        return target
          ? await target.readCurrent()
          : { model: null, mode: null, configOptions: {} };
      },
      models: async ({ harness, provider }) =>
        await harnessConfigFor(harness)?.models(provider),
      watch: (signal) =>
        noticeStream(
          { topic: "models" } as const,
          (onChange) => {
            listingWatchers.add(onChange);
            return { close: () => listingWatchers.delete(onChange) };
          },
          signal,
        ),
      catalog: async ({ harness }) =>
        opts.catalog?.view(harness) ?? {
          harness,
          routed: false,
          providers: [],
        },
    },
    sessionDirectory,
    triggerStateStore,
    async helloOnBoot({ agentRuntimeVersion }) {
      const capabilities = {
        contributions: contributionKinds as never,
        events: eventKinds as never,
        harnessConfig: harnessConfigPlugin?.supported ?? false,
        harnessConfigCatalog: harnessConfigPlugin?.catalog,
        sessionModel: harnessConfigPlugin?.sessionModel ?? false,
        defaultHarness,
        harnesses: Object.keys(opts.manifests).map((name) => {
          const plugin = harnessConfigs.get(name);
          const nativeTemplates =
            opts.manifests[name]?.modelRouter?.native?.templates;
          return {
            name,
            harnessConfig: plugin !== undefined,
            ...(plugin?.catalog && { harnessConfigCatalog: plugin.catalog }),
            sessionModel: plugin?.sessionModel ?? false,
            ...(plugin?.sessionSettings && {
              sessionSettings: plugin.sessionSettings,
              platformSubagentSettings: true,
            }),
            ...(plugin?.derivedStartMode && {
              derivedStartMode: plugin.derivedStartMode,
            }),
            ...(nativeTemplates?.length && { nativeTemplates }),
          };
        }),
        kbPublish: 2,
        liveUpdates: true,
        modelRouter: opts.modelRouter === true,
      };
      // UNIT_BOUNDARY_DESCRIPTION: the first retry comes fast because the usual first failure is a wake's own: the agent's gateway starts beside the guest and is often still coming up when the runtime first says hello, and a 1 s wait put that whole second on the agent's wake.
      for (let delay = 100; ; delay = Math.min(delay * 2, 30_000)) {
        const harnessConfigCurrent = await harnessConfigPlugin?.readCurrent({
          discover: false,
        });
        const harnessConfigCurrentByHarness = await harnessConfigByHarness();
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
            harnessConfigCurrentByHarness,
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
