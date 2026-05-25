import { join } from "node:path";
import type { RuntimeChannelService } from "agent-runtime-api";
import { loadManifest, type RuntimeManifest } from "./manifest.js";
import { createStateStore } from "./state-store.js";
import { createFileImpl } from "./drivers/file-impl.js";
import {
  createSkillInstallImpl,
  type SkillInstallContext,
} from "./drivers/skill-install-impl.js";
import { createDispatcher } from "./dispatcher.js";
import { createHarnessClient, type HarnessClient } from "./harness-client.js";
import { createRuntimeChannelService } from "./service.js";
import { runHello } from "./hello.js";

export interface RuntimeChannelComposition {
  service: RuntimeChannelService;
  manifest: RuntimeManifest;
  helloOnBoot(opts: { agentRuntimeVersion: string }): Promise<void>;
}

/**
 * Composes the runtime channel module: load manifest, build impls and
 * dispatcher, wire the harness client, return the service implementing
 * `runtime.v1.applyState` for tRPC.
 *
 * The caller is responsible for invoking `helloOnBoot` after the HTTP server
 * is listening — the api-server's `hello` handler may immediately push a
 * payload back via this process's tRPC route.
 */
export function composeRuntimeChannel(opts: {
  manifestPath: string;
  agentHome: string;
  apiServerUrl: string;
  agentId: string;
  installSkill: SkillInstallContext["install"];
  log?: (msg: string) => void;
}): RuntimeChannelComposition {
  const log = opts.log ?? ((m) => process.stderr.write(`[runtime] ${m}\n`));

  const manifest = loadManifest(opts.manifestPath);

  const stateStore = createStateStore(
    join(opts.agentHome, ".platform/runtime-state.json"),
  );
  const fileImpl = createFileImpl();
  const skillInstallImpl = createSkillInstallImpl();

  // Expand `$VAR` references in manifest paths against the agent's HOME.
  // We only support a fixed set — the manifest is authored, not user-typed.
  const expandPath = (p: string): string =>
    p
      .replace(/\$HOME\b/g, opts.agentHome)
      .replace(/\$\{HOME\}/g, opts.agentHome);

  const dispatcher = createDispatcher({
    manifest,
    fileImpl,
    skillInstallImpl,
    installSkill: opts.installSkill,
    expandPath,
  });

  const harnessClient: HarnessClient = createHarnessClient({
    apiServerUrl: opts.apiServerUrl,
    agentId: opts.agentId,
  });

  const service = createRuntimeChannelService({
    dispatcher,
    stateStore,
    harnessClient,
    agentHome: opts.agentHome,
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
          contributions: manifest.capabilities.contributions as never,
          events: manifest.capabilities.events as never,
        },
        agentRuntimeVersion,
        log,
      });
    },
  };
}
