import { err, ok, type Result } from "agent-runtime-api";
import type {
  RuntimeChannelDomainError,
  RuntimeChannelService,
} from "agent-runtime-api";
import type {
  Contribution,
  RuntimeChannelApplyStateResult,
  SignalEvent,
  StateEvent,
} from "api-server-api";
import type { DriverContext, DriverRegistry } from "./drivers/index.js";
import type { ServerHelloAckClient } from "./server-client.js";

/** Runtime-channel state held in-process for the lifetime of the pod.
 *  - `currentVersion` / `appliedHash` — what the agent has actually
 *    applied. The api-server's worker compares the version on incoming
 *    applyState calls against this; older deliveries are rejected.
 *  - `inFlightSignals` — ids the agent is processing or just finished.
 *    Used to deduplicate `deliverSignal` against `pendingSignals`
 *    returned by `hello` (the redeliver-on-reconnect path). */
export interface RuntimeChannelState {
  currentVersion: string;
  appliedHash: string;
  inFlightSignals: Set<string>;
}

export function createRuntimeChannelState(): RuntimeChannelState {
  return {
    currentVersion: "",
    appliedHash: "",
    inFlightSignals: new Set(),
  };
}

export interface RuntimeChannelServiceDeps {
  state: RuntimeChannelState;
  registry: DriverRegistry;
  driverContext: DriverContext;
  serverClient: ServerHelloAckClient;
  log?: (msg: string) => void;
}

export function createRuntimeChannelServiceImpl(
  deps: RuntimeChannelServiceDeps,
): RuntimeChannelService {
  const log = deps.log ?? deps.driverContext.log;

  return {
    async applyState(event) {
      return applyState(event, deps, log);
    },
    async deliverSignal(event) {
      return deliverSignal(event, deps, log);
    },
  };
}

export async function applyState(
  event: StateEvent,
  deps: RuntimeChannelServiceDeps,
  log: (msg: string) => void,
): Promise<Result<RuntimeChannelApplyStateResult, RuntimeChannelDomainError>> {
  if (event.version <= deps.state.currentVersion && deps.state.currentVersion) {
    return ok({
      appliedHash: deps.state.appliedHash,
      rejected: { reason: "older-version" },
    });
  }
  if (event.hash === deps.state.appliedHash) {
    deps.state.currentVersion = event.version;
    return ok({
      appliedHash: deps.state.appliedHash,
    });
  }
  const missing: string[] = [];
  for (const c of event.contributions) {
    if (!deps.registry.applyKinds.has(c.kind)) missing.push(c.kind);
  }
  if (missing.length) {
    return err({
      kind: "MissingCapability",
      missing,
    });
  }

  for (const c of event.contributions) {
    const driver = deps.registry.resolveContribution(c.kind);
    if (!driver) continue;
    try {
      await driver.apply(c as Contribution, deps.driverContext);
    } catch (e) {
      log(`[runtime-channel] driver ${c.kind} failed: ${(e as Error).message}`);
      return err({
        kind: "ApplyFailed",
        reason: `${c.kind}: ${(e as Error).message}`,
      });
    }
  }

  deps.state.currentVersion = event.version;
  deps.state.appliedHash = event.hash;
  return ok({
    appliedHash: event.hash,
  });
}

export async function deliverSignal(
  signal: SignalEvent,
  deps: RuntimeChannelServiceDeps,
  log: (msg: string) => void,
): Promise<Result<{ ok: true }, RuntimeChannelDomainError>> {
  if (deps.state.inFlightSignals.has(signal.id)) {
    return ok({ ok: true });
  }
  if (Date.parse(signal.expiresAt) <= Date.now()) {
    log(`[runtime-channel] signal ${signal.id} expired before processing`);
    return ok({ ok: true });
  }
  const driver = deps.registry.resolveSignal(signal.action);
  if (!driver) {
    return err({
      kind: "MissingCapability",
      missing: [signal.action],
    });
  }
  deps.state.inFlightSignals.add(signal.id);
  try {
    await driver.handle(signal, deps.driverContext);
    await deps.serverClient.ack(signal.id);
    return ok({ ok: true });
  } catch (e) {
    log(
      `[runtime-channel] signal ${signal.id} (${signal.action}) failed: ${(e as Error).message}`,
    );
    return err({
      kind: "ApplyFailed",
      reason: (e as Error).message,
    });
  } finally {
    deps.state.inFlightSignals.delete(signal.id);
  }
}
