import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import {
  RunFailedError,
  type RunsService,
} from "../../modules/runs/services/runs-service.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { resolveAgent } from "./agent-auth.js";

// Per-agent ceiling on concurrent `dam-run` executors, and the SOLE bound on
// recursion: an executor egresses through the parent's gateway with the parent
// agent's identity, which the waypoint authorizes for `/api/agents/<parent>/*`
// — including `/run` — so a command inside an executor can spawn its own
// dam-run (nesting depth N = N concurrent runs for the agent). Unlike forks
// there is no SA-scoping guard (executors borrow the parent's gateway, they get
// no SA of their own), so this cap is what stops a runaway loop from exhausting
// the cluster. Counted in-memory per api-server process (replicas=1). Upgrade
// path: lift to a config value if real workloads need more.
const MAX_CONCURRENT_RUNS_PER_AGENT = 16;

const PENDING_BUFFER_MAX_BYTES = 4 * 1024 * 1024;

// Ping cadence for both relay legs. Pings serve two jobs at once: the frames
// reset every Envoy stream-idle timer on the agent↔api-server path (5-min
// default when the gateway's CONNECT-route override isn't rendered), so a
// quiet long-running command isn't cut mid-stream; and a missed pong detects a
// half-open peer (node died without FIN), releasing the Run CR and the
// concurrency slot promptly instead of waiting for the 60-min reaper. Both
// peers (undici in dam-run, ws in agent-runtime) auto-pong per RFC 6455.
const KEEPALIVE_INTERVAL_MS = 30_000;

// Bounds the relay→executor dial: waitReady proved the pod Ready, so a
// handshake that still hangs means a wedged runtime — fail the run rather
// than sit silent.
const EXECUTOR_HANDSHAKE_TIMEOUT_MS = 10_000;

/** Shared with the dam-vm relay — see the cadence rationale above. */
export function keepalive(sock: WebSocket) {
  let alive = true;
  sock.on("pong", () => {
    alive = true;
  });
  const timer = setInterval(() => {
    if (sock.readyState !== WebSocket.OPEN) return;
    if (!alive) return sock.terminate();
    alive = false;
    sock.ping();
  }, KEEPALIVE_INTERVAL_MS);
  sock.on("close", () => clearInterval(timer));
}

export function createRunRelay(deps: {
  k8s: K8sClient;
  runs: RunsService;
  /** agent-runtime port on the executor pod; injectable for tests. */
  executorPort?: number;
}) {
  const executorPort = deps.executorPort ?? 8080;
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const livePerAgent = new Map<string, number>();

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ) {
    wss.handleUpgrade(req, socket, head, async (client) => {
      client.on("error", () => client.terminate());

      const live = livePerAgent.get(agentId) ?? 0;
      if (live >= MAX_CONCURRENT_RUNS_PER_AGENT) {
        client.close(
          1013,
          `too many concurrent dam-run executors (max ${MAX_CONCURRENT_RUNS_PER_AGENT})`,
        );
        return;
      }
      livePerAgent.set(agentId, live + 1);

      const runId = deps.runs.newRunId();
      const abort = new AbortController();
      let upstream: WebSocket | undefined;
      let clientGone = false;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        livePerAgent.set(agentId, (livePerAgent.get(agentId) ?? 1) - 1);
        abort.abort();
        try {
          upstream?.close();
        } catch {}
        // Deleting the Run CR cascades to the executor + gateway via ownerRefs.
        void deps.runs.delete(runId);
      };

      // Buffer client frames (e.g. the tty's initial OP_RESIZE) until the
      // executor's /api/exec is connected.
      const pending: [Buffer, boolean][] = [];
      let pendingBytes = 0;
      let overflow = false;
      const buffer = (d: Buffer, b: boolean) => {
        if (overflow) return;
        pendingBytes += d.byteLength;
        if (pendingBytes > PENDING_BUFFER_MAX_BYTES) {
          overflow = true;
          try {
            client.close(1013, "buffer full");
          } catch {
            client.terminate();
          }
          return;
        }
        pending.push([d, b]);
      };
      // Attached before the first await: the socket is live from the upgrade,
      // and a close (or frame) emitted while we resolve/create/wait must not
      // be missed — a missed close would leave the executor running
      // untethered until the reaper, pinning a concurrency slot.
      client.on("message", buffer);
      client.on("close", () => {
        clientGone = true;
        release();
      });
      keepalive(client);

      try {
        // The waypoint AuthorizationPolicy already proved the caller is this
        // agent; resolveAgent just confirms the Agent exists.
        const identity = await resolveAgent(deps.k8s, agentId);
        if (!identity) {
          client.close(1011, "agent not found");
          return release();
        }
        if (clientGone || overflow) return release();

        await deps.runs.create(runId, agentId, identity.uid);
        // A close that raced create(): release() already ran and its delete
        // may have preceded the write — re-delete what create just wrote.
        if (released) return void deps.runs.delete(runId);

        const podIP = await deps.runs.waitReady(runId, abort.signal);
        if (clientGone || overflow) return release();

        // dam-run passed the exec params (argv/cwd/cols/rows) as query on the
        // upgrade URL; forward that query verbatim to the executor's /api/exec.
        const search = new URL(req.url ?? "/", "http://localhost").search;
        upstream = new WebSocket(
          `ws://${podIP}:${executorPort}/api/exec${search}`,
          { handshakeTimeout: EXECUTOR_HANDSHAKE_TIMEOUT_MS },
        );
        const us = upstream;
        keepalive(us);
        us.on("open", () => {
          if (clientGone || overflow) return release();
          client.off("message", buffer);
          for (const [d, b] of pending) us.send(d, { binary: b });
          client.on("message", (d, isBinary) => {
            if (us.readyState === WebSocket.OPEN)
              us.send(d, { binary: isBinary });
          });
          us.on("message", (d, isBinary) => {
            if (client.readyState === WebSocket.OPEN)
              client.send(d, { binary: isBinary });
          });
        });
        us.on("close", (code) => {
          // Normally the exec side sent OP_EXIT and closed 1000, and dam-run
          // already exited on the OP_EXIT. Anything else (pod died, reaper,
          // runtime crash) surfaces as a reason so dam-run isn't silent.
          try {
            if (code === 1000) client.close(1000);
            else client.close(1011, "executor connection lost");
          } catch {}
          release();
        });
        us.on("error", () => {
          if (client.readyState === WebSocket.OPEN)
            client.close(1011, "executor connection failed");
          release();
        });
      } catch (cause) {
        const reason =
          cause instanceof RunFailedError
            ? cause.message
            : "executor start failed";
        if (client.readyState === WebSocket.OPEN)
          client.close(1011, reason.slice(0, 120));
        release();
      }
    });
  }

  return { handleUpgrade };
}
