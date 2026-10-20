import type { WebSocket } from "ws";

const PING_INTERVAL_MS = 30_000;

// UNIT_BOUNDARY_DESCRIPTION: a relayed client socket carries no traffic while its session is quiet, and networks that cut quiet connections (mobile carriers, proxies, load balancers) would drop it. A WS ping every 30 seconds keeps it open, and a client that has not answered the previous ping is terminated, so a half-dead connection releases its session presence.
export function keepAlive(client: WebSocket): void {
  let alive = true;
  client.on("pong", () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      client.terminate();
      return;
    }
    alive = false;
    try {
      client.ping();
    } catch {}
  }, PING_INTERVAL_MS);
  client.once("close", () => clearInterval(heartbeat));
}
