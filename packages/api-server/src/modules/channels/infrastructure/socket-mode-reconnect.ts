import { formatError } from "../../../core/format-error.js";

const SOCKET_RECONNECT_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

export interface ReconnectableSocket {
  on(event: "disconnected", listener: () => void): unknown;
  start(): Promise<unknown>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reconnecting the Slack Socket Mode connection
 * after it drops. The Socket Mode client runs with its own reconnect turned
 * off, because that reconnect leaves a refused `apps.connections.open` (such
 * as `invalid_auth`) as an unhandled rejection, and an unhandled rejection
 * ends the api-server process. Here every reconnect is awaited: a refused one
 * is logged and tried again after the next delay, up to the last delay, so a
 * Slack outage takes down only Slack and the socket comes back once Slack
 * accepts the app token again. A reconnect that succeeds resets the delays.
 */
export function keepSocketModeConnected(
  socket: ReconnectableSocket,
  delaysMs: readonly number[] = SOCKET_RECONNECT_DELAYS_MS,
): { stop(): void } {
  let stopped = false;
  let reconnecting = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(): number {
    const delayMs = delaysMs[Math.min(failures, delaysMs.length - 1)]!;
    timer = setTimeout(() => void reconnect(), delayMs);
    timer.unref?.();
    return delayMs;
  }

  async function reconnect() {
    timer = null;
    if (stopped) return;
    reconnecting = true;
    try {
      await socket.start();
      failures = 0;
      process.stderr.write("[slack] Socket Mode reconnected\n");
    } catch (err) {
      failures += 1;
      if (stopped) return;
      const delayMs = schedule();
      process.stderr.write(
        `[slack] Socket Mode reconnect failed, retrying in ${delayMs / 1000}s: ${formatError(err)}\n`,
      );
    } finally {
      reconnecting = false;
    }
  }

  socket.on("disconnected", () => {
    if (stopped || reconnecting || timer) return;
    process.stderr.write("[slack] Socket Mode disconnected, reconnecting\n");
    schedule();
  });

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
