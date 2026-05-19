import type { AgentView } from "../domain/agent-view.js";
import type { AgentService } from "./agent-service.js";

/**
 * Polls `agents.get(id)` at a fixed 2 s cadence until the agent is
 * `running`, `error`, or the deadline passes. Used by `create --wait`
 * and `restart --wait`. The 2 s interval is locked — see spec §4.6.
 *
 * `state === "running"` already implies pod readiness; the server
 * computes the projection from `currentState + podReady`.
 */

export interface WaitOptions {
  timeoutSeconds: number;
  /** Sleep before the first poll. Restart passes 2 s to let the
   *  controller's reconciler observe the desired-state flip; create
   *  passes 0 because the freshly-created agent is already starting. */
  graceSeconds: number;
  /** Fires once per *state change*, not per poll. The first call is
   *  guaranteed for the initial observed state. */
  onStateChange?: (state: AgentView["state"]) => void;
}

export type WaitResult =
  | { kind: "ready"; agent: AgentView }
  | { kind: "error"; agent: AgentView }
  | { kind: "timeout"; lastState: AgentView["state"] }
  | { kind: "transport"; reason: string };

const POLL_INTERVAL_MS = 2000;

export async function waitForRunning(
  svc: AgentService,
  id: string,
  opts: WaitOptions,
): Promise<WaitResult> {
  if (opts.graceSeconds > 0) {
    await sleep(opts.graceSeconds * 1000);
  }
  const deadline = Date.now() + opts.timeoutSeconds * 1000;
  let lastState: AgentView["state"] | undefined;
  // Poll-then-check-deadline so a state transition that lands during the
  // final sleep is still observed: the previous shape (`while (now < deadline)`)
  // would exit after the last sleep without one more poll, reporting timeout
  // for an agent that actually reached `running` in the last 2s window.
  while (true) {
    const result = await svc.get(id);
    if (!result.ok) return { kind: "transport", reason: result.error.reason };
    if (result.value === null)
      return { kind: "transport", reason: "agent disappeared during wait" };
    const agent = result.value;
    if (agent.state !== lastState) {
      lastState = agent.state;
      opts.onStateChange?.(agent.state);
    }
    if (agent.state === "running") return { kind: "ready", agent };
    if (agent.state === "error") return { kind: "error", agent };
    if (Date.now() >= deadline)
      return { kind: "timeout", lastState: agent.state };
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
