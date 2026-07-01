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

export function createRunRelay(deps: { k8s: K8sClient; runs: RunsService }) {
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

      // The waypoint AuthorizationPolicy already proved the caller is this
      // agent; resolveAgent just confirms the Agent exists.
      const identity = await resolveAgent(deps.k8s, agentId);
      if (!identity) {
        client.close(1011, "agent not found");
        return;
      }

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
      client.on("message", buffer);
      client.on("close", () => {
        clientGone = true;
        release();
      });

      try {
        await deps.runs.create(runId, agentId, identity.uid);
        const podIP = await deps.runs.waitReady(runId, abort.signal);
        if (clientGone || overflow) return release();

        // dam-run passed the exec params (argv/cwd/cols/rows) as query on the
        // upgrade URL; forward that query verbatim to the executor's /api/exec.
        const search = new URL(req.url ?? "/", "http://localhost").search;
        upstream = new WebSocket(`ws://${podIP}:8080/api/exec${search}`);
        const us = upstream;
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
          us.on("close", () => {
            try {
              client.close();
            } catch {}
            release();
          });
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
