import type { RuntimeChannelService } from "agent-runtime-api";
import {
  createBuiltinDriverRegistry,
  createDriverRegistry,
  type Driver,
  type DriverContext,
  type DriverRegistry,
  type SignalDriver,
} from "./drivers/index.js";
import { loadManifestFromFile, type RuntimeManifest } from "./manifest.js";
import { createHelloLoop, type HelloLoop } from "./hello-loop.js";
import {
  createServerHelloAckClient,
  type ServerHelloAckClient,
} from "./server-client.js";
import {
  createRuntimeChannelServiceImpl,
  createRuntimeChannelState,
  type RuntimeChannelState,
} from "./service.js";

export interface RuntimeChannelSystem {
  service: RuntimeChannelService;
  registry: DriverRegistry;
  state: RuntimeChannelState;
  helloLoop: HelloLoop;
  client: ServerHelloAckClient;
}

export interface ComposeRuntimeChannelInput {
  /** Harness API base URL for THIS agent — built by the controller
   *  per ADR-041 and injected via env. Empty string disables the
   *  runtime channel entirely (forks, tests). */
  harnessApiBaseUrl: string;
  runtimeVersion: string;
  agentHome: string;
  /** Manifest path (defaults to `<agentHome>/runtime-manifest.yaml`).
   *  Absent file is fine; the built-ins are always available. */
  manifestPath?: string;
  /** Drivers contributed by the per-harness image. Each must declare a
   *  kind not present in the built-in set; collision throws on compose.
   *  See ADR-048 "Manifest overrides". */
  extraDrivers?: Driver[];
  extraSignalDrivers?: SignalDriver[];
  log?: (msg: string) => void;
}

export async function composeRuntimeChannel(
  input: ComposeRuntimeChannelInput,
): Promise<RuntimeChannelSystem> {
  const log = input.log ?? ((msg: string) => process.stderr.write(msg + "\n"));
  const builtins = createBuiltinDriverRegistry();
  const builtinKinds = new Set(builtins.applyKinds);
  const builtinSignals = new Set(builtins.signalActions);

  const manifest = input.manifestPath
    ? await loadManifestFromFile(input.manifestPath)
    : await loadManifestFromFile(`${input.agentHome}/runtime-manifest.yaml`);
  if (manifest) {
    assertManifestNoCollision(manifest, builtinKinds, builtinSignals);
  }

  const extraDrivers = input.extraDrivers ?? [];
  const extraSignalDrivers = input.extraSignalDrivers ?? [];

  for (const d of extraDrivers) {
    if (builtinKinds.has(d.kind)) {
      throw new Error(
        `runtime-channel: extra driver collides with built-in kind ${d.kind}`,
      );
    }
  }
  for (const d of extraSignalDrivers) {
    for (const a of d.actions) {
      if (builtinSignals.has(a)) {
        throw new Error(
          `runtime-channel: extra signal driver collides with built-in action ${a}`,
        );
      }
    }
  }

  const registry = createDriverRegistry({
    drivers: [...mapBuiltin(builtins, "applyKinds"), ...extraDrivers],
    signalDrivers: extraSignalDrivers,
  });

  const state = createRuntimeChannelState();
  const driverContext: DriverContext = { agentHome: input.agentHome, log };
  const client = createServerHelloAckClient({
    baseUrl: input.harnessApiBaseUrl,
  });

  const serviceDeps = {
    state,
    registry,
    driverContext,
    serverClient: client,
    log,
  };

  const service = createRuntimeChannelServiceImpl(serviceDeps);
  const helloLoop = createHelloLoop(serviceDeps, {
    runtimeVersion: input.runtimeVersion,
    log,
  });

  return { service, registry, state, helloLoop, client };
}

function assertManifestNoCollision(
  manifest: RuntimeManifest,
  builtinKinds: ReadonlySet<string>,
  builtinSignals: ReadonlySet<string>,
): void {
  for (const k of manifest.contributionKinds) {
    if (builtinKinds.has(k)) {
      throw new Error(
        `runtime-channel manifest declares contribution kind "${k}" already provided by built-ins`,
      );
    }
  }
  for (const a of manifest.signalActions) {
    if (builtinSignals.has(a)) {
      throw new Error(
        `runtime-channel manifest declares signal action "${a}" already provided by built-ins`,
      );
    }
  }
}

/** Iterate built-in drivers as a Driver array. We rebuild the array from
 *  the registry's `applyKinds` because the built-in registry is the
 *  authoritative source — duplicating the constants here would drift. */
function mapBuiltin(registry: DriverRegistry, field: "applyKinds"): Driver[] {
  const out: Driver[] = [];
  for (const k of registry[field]) {
    const d = registry.resolveContribution(k);
    if (d) out.push(d);
  }
  return out;
}

export type {
  Driver,
  DriverContext,
  DriverRegistry,
  SignalDriver,
} from "./drivers/index.js";
export type { ServerHelloAckClient } from "./server-client.js";
export type { HelloLoop } from "./hello-loop.js";
export type { RuntimeChannelState } from "./service.js";
