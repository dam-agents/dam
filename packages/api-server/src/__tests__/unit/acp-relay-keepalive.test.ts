// TEST_OVERVIEW: the ACP relay pings its chat client every 30 seconds from the moment the client connects, as the terminal, SSH and browser relays do. A quiet chat socket then carries traffic, and a client that leaves a ping unanswered is terminated, which releases its session presence so the agent can hibernate.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { createAcpRelay } from "../../apps/api-server/agent-proxies/acp-relay.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { ApprovalsRelayService } from "../../modules/approvals/compose.js";
import type { SessionPresence } from "../../apps/api-server/agent-proxies/session-presence.js";
import type { FirePair } from "../../modules/harness-config/index.js";

const PING_INTERVAL_MS = 30_000;

const repo = {
  resolveIdentity: async (agentId: string) => ({ owner: "u", agentId }),
  ensureReady: () => new Promise<void>(() => {}),
  peekCached: () => null,
} as unknown as AgentsRepository;

const approvals = {
  subscribeFrameInjects: () => () => {},
} as unknown as ApprovalsRelayService;

const firePair: FirePair = async () => undefined;

const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const s of servers.splice(0))
    await new Promise((r) => s.close(() => r(null)));
});

async function attach(presence: SessionPresence, autoPong = true) {
  const relay = createAcpRelay("ns", repo, approvals, presence, firePair);
  const server = createServer();
  servers.push(server);
  server.on("upgrade", (req, socket, head) => {
    relay.handleUpgrade(req, socket, head, "agent-1", {
      sub: "u",
      surface: "ui",
      attached: () => {},
      editor: null,
      email: null,
      opened: () => {},
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/`, { autoPong });
  sockets.push(ws);
  await new Promise<void>((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  return ws;
}

describe("ACP relay keepalive", () => {
  // TEST_SCENARIO: while the harness waits for the next prompt, no frame crosses the chat socket, and networks that close quiet connections cut it. The relay pings the client 30 seconds after it connects, also while the agent is still waking.
  it("pings a quiet chat client while its agent wakes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const presence = { acquire: () => () => {} } as unknown as SessionPresence;
    const ws = await attach(presence);

    const ping = new Promise<void>((r) => ws.once("ping", () => r()));
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    await ping;

    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // TEST_SCENARIO: a chat client whose network went away sends no close frame, and its open socket keeps the `active-session` hold, so the agent never hibernates. The relay terminates it once it leaves a ping unanswered, and that releases the hold.
  it("terminates a chat client that leaves a ping unanswered and releases its presence", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const release = vi.fn();
    const presence = { acquire: () => release } as unknown as SessionPresence;
    const ws = await attach(presence, false);
    const closed = new Promise<number>((r) =>
      ws.once("close", (code) => r(code)),
    );

    const ping = new Promise<void>((r) => ws.once("ping", () => r()));
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    await ping;
    vi.advanceTimersByTime(PING_INTERVAL_MS);

    expect(await closed).toBe(1006);
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
  });
});
