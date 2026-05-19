import type { Instance } from "api-server-api";
import type { InstanceService } from "./instance-service.js";

/**
 * Polls `instances.get(id)` at a fixed 2 s cadence until the instance is
 * `running`, `error`, or the deadline passes. Used by `create --wait`
 * and (in Phase 4) `restart --wait`. The 2 s interval is locked — see
 * spec §4.6.
 *
 * `state === "running"` already implies pod readiness; the server
 * computes the projection from `currentState + podReady` in
 * `instance-assembly.ts:computeState`.
 */

export interface WaitOptions {
  timeoutSeconds: number;
  /** Sleep before the first poll. Restart passes 2 s to let the
   *  controller's reconciler observe the desired-state flip; create
   *  passes 0 because the freshly-created instance is already starting. */
  graceSeconds: number;
  /** Fires once per *state change*, not per poll. The first call is
   *  guaranteed for the initial observed state. */
  onStateChange?: (state: Instance["state"]) => void;
}

export type WaitResult =
  | { kind: "ready"; instance: Instance }
  | { kind: "error"; instance: Instance }
  | { kind: "timeout"; lastState: Instance["state"] }
  | { kind: "transport"; reason: string };

const POLL_INTERVAL_MS = 2000;

export async function waitForRunning(
  svc: InstanceService,
  id: string,
  opts: WaitOptions,
): Promise<WaitResult> {
  if (opts.graceSeconds > 0) {
    await sleep(opts.graceSeconds * 1000);
  }
  const deadline = Date.now() + opts.timeoutSeconds * 1000;
  let lastState: Instance["state"] | undefined;
  // Poll-then-check-deadline so a state transition that lands during the
  // final sleep is still observed: the previous shape (`while (now < deadline)`)
  // would exit after the last sleep without one more poll, reporting timeout
  // for an instance that actually reached `running` in the last 2s window.
  while (true) {
    const result = await svc.get(id);
    if (!result.ok) return { kind: "transport", reason: result.error.reason };
    if (result.value === null)
      return { kind: "transport", reason: "instance disappeared during wait" };
    const inst = result.value;
    if (inst.state !== lastState) {
      lastState = inst.state;
      opts.onStateChange?.(inst.state);
    }
    if (inst.state === "running") return { kind: "ready", instance: inst };
    if (inst.state === "error") return { kind: "error", instance: inst };
    if (Date.now() >= deadline)
      return { kind: "timeout", lastState: inst.state };
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
