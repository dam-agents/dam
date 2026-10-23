import type { AgentView } from "../../../types.js";
import type { AgentDisplayState } from "../utils/agent-resolver.js";

export type AgentReadiness = "ready" | "starting" | "down";

export const AGENT_DID_NOT_START =
  "Not sent — the agent stopped before it was ready.";

export const LEFT_BEFORE_START =
  "Not sent — the page closed before the agent was ready.";

export function agentReadiness(
  agent: Pick<AgentView, "state" | "overBudget"> | undefined,
  operable: boolean,
  waking: boolean,
): AgentReadiness {
  if (operable) return "ready";
  if (!agent || agent.overBudget) return "down";
  return waking ||
    agent.state === "starting" ||
    agent.state === "preparing_workspace" ||
    agent.state === "running"
    ? "starting"
    : "down";
}

// UNIT_BOUNDARY_DESCRIPTION: whether the chat stays usable while the agent starts, rather than sitting behind the full-screen overlay. An agent boots in seconds, so its chat opens at once with a held composer and a provisional session list.
export function startsInChat(state: AgentDisplayState): boolean {
  return state === "starting" || state === "preparing_workspace";
}

// UNIT_BOUNDARY_DESCRIPTION: a prompt typed while the agent starts is held in the browser until the agent is running. The api-server relay already waits for the Ready condition, but Ready comes before the workspace is prepared, and a prompt must not race the workspace seed or install. The wait ends when the agent becomes operable, and fails when the agent leaves the starting states without becoming operable. An agent that is not starting when the send begins gives no wait (null): the send goes out as before and the relay wakes the agent.
export function untilAgentReady(
  read: () => AgentReadiness,
  subscribe: (onChange: () => void) => () => void,
): Promise<void> | null {
  if (read() !== "starting") return null;
  return new Promise((resolve, reject) => {
    const unsubscribe = subscribe(() => {
      const now = read();
      if (now === "starting") return;
      unsubscribe();
      if (now === "ready") resolve();
      else reject(new Error(AGENT_DID_NOT_START));
    });
  });
}

export async function askAgainWhenReady<T>(
  ask: () => Promise<T>,
  untilReady: () => Promise<void> | null,
): Promise<T> {
  try {
    return await ask();
  } catch (err) {
    const ready = untilReady();
    if (!ready) throw err;
    await ready;
    return ask();
  }
}

// UNIT_BOUNDARY_DESCRIPTION: a session action chosen while the agent cannot answer, such as Rename or Delete on a provisional row, wakes the agent and runs once it answers. Readiness is read when the action runs, not when the menu opened, so an agent that woke meanwhile runs the action at once. An agent already starting is not woken again. The same action asked again while it waits is dropped, so it never runs twice. An agent that stops before it answers runs nothing.
export async function actWhenAwake({
  inFlight,
  key,
  readiness,
  wake,
  untilOperable,
  onWaiting,
  onFailed,
  act,
}: {
  inFlight: Set<string>;
  key: string;
  readiness: () => AgentReadiness;
  wake: () => void;
  untilOperable: () => Promise<void> | null;
  onWaiting: () => void;
  onFailed: () => void;
  act: () => unknown;
}): Promise<void> {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    if (readiness() === "down") wake();
    if (readiness() !== "ready") {
      const hold = untilOperable();
      if (!hold) {
        if (readiness() !== "ready") return onFailed();
      } else {
        onWaiting();
        try {
          await hold;
        } catch {
          return onFailed();
        }
      }
    }
    await act();
  } finally {
    inFlight.delete(key);
  }
}
