import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { keepalive, spliceClient } from "./harness-run-relay.js";

// Per-agent ceiling on concurrent `dam-vm` streams. Same rationale as the run
// relay's cap: this is the only local bound on runaway loops (a dam-run
// executor can spawn dam-vm with the parent's identity). The VM host
// additionally caps containers globally.
const MAX_CONCURRENT_VM_STREAMS_PER_AGENT = 16;

// First contact may cold-start the agent's container on the VM host (incus
// launch + first boot), so the dial budget is generous.
const VM_HANDSHAKE_TIMEOUT_MS = 90_000;

/**
 * Relays `dam-vm` terminal streams from the harness port to the operator's VM
 * host (packages/dam-vm) over mutual TLS: it presents the deployment's client
 * cert (which authenticates the whole hop) and forwards the waypoint-proven
 * agent id in a header — neither of which the agent can hold or choose. Unlike
 * the run relay there is no CR and no executor pod: the VM host owns container
 * lifecycle (lazy create, idle delete).
 */
export function createVmRelay(deps: {
  /** VM host relay URL, e.g. `wss://203.0.113.7:8090/run`; null → unconfigured. */
  url: string | null;
  /** mTLS client cert + key presented to the VM host (PEM); the deployment's
   *  credential. Both required for a configured host. */
  clientCert: string | null;
  clientKey: string | null;
  /** CA (PEM) to verify the host's server cert; null → system trust store. */
  caCert?: string | null;
}) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const livePerAgent = new Map<string, number>();

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ) {
    wss.handleUpgrade(req, socket, head, (client) => {
      client.on("error", () => client.terminate());

      if (!deps.url || !deps.clientCert || !deps.clientKey) {
        client.close(1011, "no VM host is configured for this deployment");
        return;
      }
      const live = livePerAgent.get(agentId) ?? 0;
      if (live >= MAX_CONCURRENT_VM_STREAMS_PER_AGENT) {
        client.close(
          1013,
          `too many concurrent dam-vm streams (max ${MAX_CONCURRENT_VM_STREAMS_PER_AGENT})`,
        );
        return;
      }
      livePerAgent.set(agentId, live + 1);

      // Unlike the run relay we do not resolveAgent() the K8s object here: the
      // VM host is external and keys containers off the id regardless, so an
      // existence check would add a round-trip without changing the outcome.
      //
      // dam-vm passed the exec params (argv/cols/rows) as query on the upgrade
      // URL; forward the query verbatim. The agent id rides a header the
      // agent-side WHATWG WebSocket cannot set — trustworthy because the
      // waypoint proved the caller is `agentId` before this relay ran. mTLS
      // (client cert) authenticates this hop as the deployment.
      const search = new URL(req.url ?? "/", "http://localhost").search;
      const upstream = new WebSocket(deps.url + search, {
        handshakeTimeout: VM_HANDSHAKE_TIMEOUT_MS,
        headers: { "x-dam-vm-agent": agentId },
        cert: deps.clientCert,
        key: deps.clientKey,
        ...(deps.caCert ? { ca: deps.caCert } : {}),
      });

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        livePerAgent.set(agentId, (livePerAgent.get(agentId) ?? 1) - 1);
        try {
          upstream.close();
        } catch {
          upstream.terminate();
        }
      };

      const spliced = spliceClient(client);
      client.on("close", release);
      keepalive(client);
      keepalive(upstream);

      upstream.on("open", () => {
        if (released || spliced.overflowed()) return release();
        spliced.splice(upstream);
      });
      upstream.on("close", (code, reason) => {
        // Forward the VM host's app-level closes (1000 after OP_EXIT, 4xxx
        // rejections carrying a reason) so dam-vm can print them; anything
        // else is an infra failure.
        try {
          if (code === 1000 || code >= 4000)
            client.close(code, reason.toString().slice(0, 120));
          else client.close(1011, "VM host connection lost");
        } catch {}
        release();
      });
      upstream.on("error", () => {
        if (client.readyState === WebSocket.OPEN)
          client.close(1011, "VM host connection failed");
        release();
      });
    });
  }

  return { handleUpgrade };
}
