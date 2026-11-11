import type { InfraAgent } from "../../../modules/agents/infrastructure/agent-mappers.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import {
  MACHINE_RESTARTING_REASON,
  MACHINE_STOPPING_REASON,
} from "../../../modules/agents/infrastructure/labels.js";

const ANSWER_POLL_MS = 100;
const ANSWER_TIMEOUT_MS = 1_000;

export type HoldStart = "ready" | "hibernated" | "running" | "restarting";
export type HoldEnd = "ready" | "answered";

async function answers(healthUrl: string): Promise<boolean> {
  try {
    const res = await fetch(healthUrl, {
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

function replacingItsMachine(infra: InfraAgent): boolean {
  return (
    infra.machineNotReadyReason === MACHINE_RESTARTING_REASON ||
    infra.machineNotReadyReason === MACHINE_STOPPING_REASON
  );
}

export function holdStartOf(infra: InfraAgent | null): HoldStart {
  if (!infra) return "restarting";
  if (infra.ready) return "ready";
  if (infra.hibernated) return "hibernated";
  if (
    infra.stopRequested ||
    replacingItsMachine(infra) ||
    infra.machineReadinessCurrent !== true
  )
    return "restarting";
  return "running";
}

// UNIT_BOUNDARY_DESCRIPTION: a relay hold that waits for a wake ends when the agent is Ready. It can end sooner: when the agent answers its health check through its Service while the cached Agent shows its gateway ready. Ready reaches the api-server only after the controller's next full reconcile writes it, and a running agent's Ready goes down whenever the controller cannot reach its machine's runner or the runner misses one probe under load, while the guest still answers. The answer is weaker than Ready, because it does not say which machine answered, so it is trusted only where a single machine can answer: a hold that begins on a hibernated Agent, since hibernation stops the machine and the controller publishes it only once the runner confirmed the stop; or one that begins on a running Agent whose readiness was published for its current spec and that is not restarting, stopping or asked to stop. A restart is published as MachineRestarting while the runner replaces the machine, and the old guest keeps answering on the same port until the runner stops it, so a hold on a restart, and one that sees the restart begin, waits for Ready. The gateway gate keeps the agent's egress up before anything is sent to it. A stop or a client that left ends the polling, and a wake that fails still rejects with its cause.
export async function readyOrAnswering(
  repo: Pick<AgentsRepository, "peekCached">,
  agentId: string,
  ready: Promise<void>,
  healthUrl: string,
  gone: () => boolean,
  start: HoldStart = holdStartOf(repo.peekCached(agentId)),
): Promise<HoldEnd> {
  const readied = ready.then((): HoldEnd => "ready");
  if (start !== "hibernated" && start !== "running") return readied;
  let settled = false;
  const done = readied.finally(() => {
    settled = true;
  });
  const answered = (async (): Promise<HoldEnd> => {
    while (!settled && !gone()) {
      await new Promise((r) => setTimeout(r, ANSWER_POLL_MS));
      const infra = repo.peekCached(agentId);
      if (infra && replacingItsMachine(infra)) return done;
      if (
        !settled &&
        infra?.gatewayPodReady &&
        !infra.stopRequested &&
        (await answers(healthUrl))
      )
        return "answered";
    }
    return done;
  })();
  return Promise.race([done, answered]);
}
