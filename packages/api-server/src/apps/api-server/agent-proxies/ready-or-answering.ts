import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";

const ANSWER_POLL_MS = 100;
const ANSWER_TIMEOUT_MS = 1_000;

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

// UNIT_BOUNDARY_DESCRIPTION: a relay hold that waits for a wake ends when the agent is Ready. A hold that begins on a hibernated Agent, whether or not its wake is already asked for, can end sooner: when the agent answers its health check through its Service while the cached Agent shows its gateway ready. Ready reaches the api-server only after the controller's next full reconcile writes it, so the relay opens its upstream that much sooner. This check is weaker than Ready, because it does not know which pod or machine revision answered. It is used only on a wake from hibernation: hibernation stops the agent's pod or machine, so what answers came up for this wake. A running agent that is not Ready can be in a restart, and a vm machine keeps answering on its port until the restart stops it, so that hold waits for Ready. A hold that begins after the controller has started the wake also waits for Ready. The controller publishes hibernation only once the runner has confirmed a vm machine stopped, so no old guest is left to answer. The gateway gate keeps the agent's egress up before anything is sent to it. A stop or a client that left ends the polling, and a wake that fails still rejects with its cause.
export async function readyOrAnswering(
  repo: Pick<AgentsRepository, "peekCached">,
  agentId: string,
  ready: Promise<void>,
  healthUrl: string,
  gone: () => boolean,
): Promise<void> {
  if (!repo.peekCached(agentId)?.hibernated) return ready;
  let settled = false;
  const done = ready.finally(() => {
    settled = true;
  });
  const answered = (async () => {
    while (!settled && !gone()) {
      await new Promise((r) => setTimeout(r, ANSWER_POLL_MS));
      const infra = repo.peekCached(agentId);
      if (
        !settled &&
        infra?.gatewayPodReady &&
        !infra.stopRequested &&
        (await answers(healthUrl))
      )
        return;
    }
    return done;
  })();
  return Promise.race([done, answered]);
}
