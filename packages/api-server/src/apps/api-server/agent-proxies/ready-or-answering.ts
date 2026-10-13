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

// UNIT_BOUNDARY_DESCRIPTION: a relay hold that waits for a wake ends when the agent is Ready, or sooner, when the agent answers its health check through its Service while the cached Agent already shows its gateway ready. Ready reaches the api-server only after the controller's next full reconcile writes it, about half a second after the guest answers; the health check is the same one that makes the agent Ready, so the relay opens its upstream that much sooner. The gateway gate keeps the agent's egress up before anything is sent to it. A stop, a runtime migration or a client that left ends the polling, and a wake that fails still rejects with its cause.
export async function readyOrAnswering(
  repo: Pick<AgentsRepository, "peekCached">,
  agentId: string,
  ready: Promise<void>,
  healthUrl: string,
  gone: () => boolean,
): Promise<void> {
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
        (infra.runtimeMigrationHold ?? "none") === "none" &&
        (await answers(healthUrl))
      )
        return;
    }
    return done;
  })();
  return Promise.race([done, answered]);
}
