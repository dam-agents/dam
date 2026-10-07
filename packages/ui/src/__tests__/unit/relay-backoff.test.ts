import { describe, expect, it } from "vitest";

import { relayBackoff } from "../../modules/agents/lib/relay-backoff.js";

/**
 * TEST_OVERVIEW: The agent tRPC relay reconnect delay. The api-server accepts the relay socket and then closes it while the agent is unreachable, and tRPC restarts its attempt count at every open. The delay must still grow across those accepted-then-closed sockets, and must go back to an immediate reconnect once a connection has stayed up.
 */
describe("relayBackoff", () => {
  // TEST_SCENARIO: each socket opens and closes at once, as the relay does for an unreachable agent; tRPC asks for attempt 0 every time, and the delay must still grow to the 30 s cap.
  it("backs off across sockets that open and close at once", () => {
    let t = 0;
    const backoff = relayBackoff(() => t);
    const delays = Array.from({ length: 7 }, () => {
      backoff.onOpen();
      t += 50;
      backoff.onClose();
      const delay = backoff.retryDelayMs(0);
      t += delay;
      return delay;
    });
    expect(delays).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  // TEST_SCENARIO: a connection that stayed up is healthy, so its close reconnects immediately as before, even after a run of churn.
  it("resets after a stable connection", () => {
    let t = 0;
    const backoff = relayBackoff(() => t);
    backoff.onOpen();
    backoff.onClose();
    expect(backoff.retryDelayMs(0)).toBe(2_000);
    backoff.onOpen();
    t += 60_000;
    backoff.onClose();
    expect(backoff.retryDelayMs(0)).toBe(0);
  });
});
