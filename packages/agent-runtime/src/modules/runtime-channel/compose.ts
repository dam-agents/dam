import { join } from "node:path";
import { eventKind } from "agent-runtime-api";
import type {
  EventReportInput,
  ContributionKind,
  HarnessConfigCurrent,
  HarnessConfigService,
  Plugin,
  RuntimeChannelService,
  SessionDirectoryEntry,
} from "agent-runtime-api";
import type { DocumentStoreBackend } from "../../core/document-store.js";
import type { LeaseEnvReader } from "../../core/runtime-env.js";
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
import { createTriggerStateStore } from "./infrastructure/trigger-state-store.js";
import { createTriggerPlugin } from "./drivers/trigger-plugin.js";
import { createPrecheckRunner } from "./infrastructure/precheck-runner.js";
import { createWorkspaceSeedPlugin } from "./drivers/workspace-seed-plugin.js";
import { createWorkspaceCommandPlugin } from "./drivers/workspace-command-plugin.js";
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
import { createPluginRegistry } from "./infrastructure/plugin-registry.js";
import { loadExtensions } from "./infrastructure/extension-loader.js";
import type { HarnessClient } from "./harness-client.js";
import { createRuntimeChannelService } from "./service.js";
import {
  SEED_LISTING_RETRY,
  createHarnessConfigPlugin,
  type HarnessConfigPlugin,
} from "./drivers/harness-config-plugin.js";
import { createModelDiscovery } from "./infrastructure/model-discovery.js";
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
  seedHarnessModel(): Promise<boolean>;
  leaseModel(lease: {
    harness: string;
    provider: string | null;
  }): Promise<string | null>;
  sessionDirectory: SessionDirectoryReporter;
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
  subAgentSessions: SubAgentSessionStore;
  findSessionByRef?: (ref: string) => string | undefined;
  readSessions: () => readonly SessionDirectoryEntry[];
  plugins: readonly Plugin[];
  envReader: LeaseEnvReader;
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
      harnessDefault: async () =>
        harnessConfigPlugin?.supported
          ? ((await harnessConfigPlugin.readCurrent({ discover: false }))
              .defaultModel ?? null)
          : null,
      runPrecheck: createPrecheckRunner({
        workDir: opts.workDir,
        envReader: opts.envReader,
      }),
      log,
      reporter,
      ...(opts.findSessionByRef
        ? { findSessionByRef: opts.findSessionByRef }
        : {}),
    }),
  );
  registry.register(createWorkspaceSeedPlugin({ workDir: opts.workDir, log }));
  registry.register(
    createWorkspaceCommandPlugin({ workDir: opts.workDir, log }),
  );
  registry.register(createInitializationPlugin({ driver: opts.triggerDriver }));
  registry.register(
    createSatelliteOutcomePlugin({ driver: opts.triggerDriver }),
  );
  registry.register(
    createSubAgentOutcomePlugin({
      driver: opts.triggerDriver,
      sessions: opts.subAgentSessions,
    }),
  );

  const discoverModels = createModelDiscovery({ log });
  const harnessConfigs = new Map<string, HarnessConfigPlugin>();
  for (const { harness, resolved: own } of resolvedByHarness) {
    const raw = own["harness-config"];
    if (!raw) continue;
    harnessConfigs.set(
      harness,
      createHarnessConfigPlugin({
        harness,
        onApplied: () => opts.onHarnessConfigApplied(harness),
        binding: harnessConfigBinding.parse(raw),
        agentHome: opts.agentHome,
        envReader: opts.envReader,
        discoverModels,
        seedListingRetry: SEED_LISTING_RETRY,
        log,
      }),
    );
  }
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
    harnessConfig: {
      readCurrent: async (input) => {
        const target = harnessConfigFor(input?.harness);
        return target
          ? await target.readCurrent()
          : { model: null, mode: null, configOptions: {} };
      },
      models: async ({ harness, provider }) =>
        await harnessConfigFor(harness)?.models(provider),
    },
    seedHarnessModel: async () =>
      (await harnessConfigPlugin?.seedModel()) ?? false,
    leaseModel: async ({ harness, provider }) =>
      (await harnessConfigs.get(harness)?.leaseModel(provider)) ?? null,
    sessionDirectory,
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
          return {
            name,
            harnessConfig: plugin !== undefined,
            ...(plugin?.catalog && { harnessConfigCatalog: plugin.catalog }),
            sessionModel: plugin?.sessionModel ?? false,
          };
        }),
        kbPublish: 2,
        liveUpdates: true,
      };
      for (let delay = 1_000; ; delay = Math.min(delay * 2, 30_000)) {
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
