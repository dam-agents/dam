import type { AgentView } from "../domain/agent-view.js";
import type { AgentService } from "./agent-service.js";

export interface WaitOptions {
  timeoutSeconds: number;
  graceSeconds: number;
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
