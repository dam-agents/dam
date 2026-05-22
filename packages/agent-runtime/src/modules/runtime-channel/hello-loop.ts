import type { RuntimeChannelCapabilities, StateEvent } from "api-server-api";
import { applyState, deliverSignal } from "./service.js";
import type { RuntimeChannelServiceDeps } from "./service.js";

export interface HelloLoopOptions {
  runtimeVersion: string;
  /** Cadence to retry hello when the boot call fails. The api-server
   *  re-pushes state via the worker once it's reachable; this loop is
   *  the agent's safety net for boot-time and reconnect races. */
  reconnectIntervalMs?: number;
  log?: (msg: string) => void;
}

export interface HelloLoop {
  /** Resolves once the first successful hello round-trip has applied
   *  state and processed signals. Re-throws on permanent failure
   *  (manifest declared a kind the server rejected, etc). */
  startAndAwait(): Promise<void>;
  stop(): void;
}

export function createHelloLoop(
  deps: RuntimeChannelServiceDeps,
  opts: HelloLoopOptions,
): HelloLoop {
  const interval = opts.reconnectIntervalMs ?? 15_000;
  const log = opts.log ?? deps.driverContext.log;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const capabilities: RuntimeChannelCapabilities = {
    kinds: Array.from(deps.registry.applyKinds),
    signals: Array.from(deps.registry.signalActions),
  };

  async function once(): Promise<boolean> {
    try {
      const result = await deps.serverClient.hello({
        runtimeVersion: opts.runtimeVersion,
        capabilities,
        lastAppliedHash: deps.state.appliedHash,
      });
      if (result.state) {
        const state: StateEvent = result.state;
        const applied = await applyState(state, deps, log);
        if (!applied.ok) {
          log(
            `[runtime-channel:hello] state apply failed: ${applied.error.kind}`,
          );
        }
      }
      for (const sig of result.pendingSignals) {
        const out = await deliverSignal(sig, deps, log);
        if (!out.ok) {
          log(
            `[runtime-channel:hello] signal ${sig.id} (${sig.action}) failed: ${out.error.kind}`,
          );
        }
      }
      return true;
    } catch (e) {
      log(`[runtime-channel:hello] failed: ${(e as Error).message}`);
      return false;
    }
  }

  return {
    async startAndAwait() {
      if (await once()) return;
      await new Promise<void>((resolve) => {
        const schedule = () => {
          if (stopped) return resolve();
          timer = setTimeout(async () => {
            if (await once()) resolve();
            else schedule();
          }, interval);
        };
        schedule();
      });
    },
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
