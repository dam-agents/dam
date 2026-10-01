const STABLE_MS = 10_000;
const MAX_DELAY_MS = 30_000;

// UNIT_BOUNDARY_DESCRIPTION: the reconnect delay for an agent's tRPC relay. The api-server accepts the relay socket before it reaches the agent pod, and closes it when the agent is unreachable. tRPC's own backoff starts again at 0 ms after every open, so an accepted-then-closed socket reconnected in a tight loop, dozens of times a second. A connection that closes before it was stable counts as churn, and churn adds to the retry attempt, up to a 30 s cap; a stable connection resets it, and a socket that never opened leaves it to tRPC's own attempt count.
export function relayBackoff(now: () => number = Date.now) {
  let openedAt: number | null = null;
  let churn = 0;
  return {
    onOpen: () => {
      openedAt = now();
    },
    onClose: () => {
      if (openedAt === null) return;
      churn = now() - openedAt < STABLE_MS ? churn + 1 : 0;
      openedAt = null;
    },
    retryDelayMs: (attemptIndex: number) => {
      const attempt = attemptIndex + churn;
      return attempt === 0 ? 0 : Math.min(1_000 * 2 ** attempt, MAX_DELAY_MS);
    },
  };
}
