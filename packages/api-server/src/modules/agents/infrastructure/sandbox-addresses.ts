import type { AgentRecord, AgentStore } from "./agent-store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where each running sandbox answers. The
 * supervisor allocates the address and publishes it on the agent's status; this
 * keeps a synchronous view of that, so relays and clients can build a URL
 * without a round trip. An agent with no address is not running, and saying so
 * loudly beats a connection that hangs.
 *
 * An agent held by another node answers at a loopback address on this one,
 * which is the far end of a tunnel to the node that holds it. Every caller
 * builds its own URL around whatever this returns, so making a remote agent
 * reachable this way is what keeps the other eighteen call sites from having
 * to know that nodes exist at all. The tunnel is opened as the placement is
 * learned rather than when it is asked for, because callers ask synchronously.
 * `localAddress` is the other direction: the sandbox's own address on this
 * node, which is what a peer's tunnel is joined to.
 */
export interface SandboxAddresses {
  baseUrl(agentId: string): string;
}

export class NoSandboxAddressError extends Error {
  constructor(readonly agentId: string) {
    super(`agent ${agentId} has no running sandbox to dial`);
    this.name = "NoSandboxAddressError";
  }
}

export interface RunningSandboxAddresses extends SandboxAddresses {
  localAddress(agentId: string): string | null;
  stop(): void;
}

export interface PeerRouting {
  nodeId: string;
  addressOfNode(nodeId: string): Promise<string | null>;
  tunnels: {
    ensure(agentId: string, peerAddress: string): Promise<string>;
    drop(agentId: string): void;
  };
  log: (message: string, fields?: Record<string, unknown>) => void;
}

export async function startSandboxAddresses(
  store: AgentStore,
  port: number,
  routing?: PeerRouting,
): Promise<RunningSandboxAddresses> {
  const local = new Map<string, string>();
  const remote = new Map<string, string>();

  const forget = (id: string) => {
    local.delete(id);
    if (remote.delete(id)) routing?.tunnels.drop(id);
  };

  function track(record: AgentRecord): void {
    const address = record.status.address;
    if (!address) return forget(record.id);
    if (!routing || record.assignedNode === routing.nodeId) {
      if (remote.delete(record.id)) routing?.tunnels.drop(record.id);
      local.set(record.id, `${address}:${port}`);
      return;
    }
    local.delete(record.id);
    const node = record.assignedNode;
    if (!node) return forget(record.id);
    void routing
      .addressOfNode(node)
      .then(async (peer) => {
        if (!peer) return forget(record.id);
        remote.set(record.id, await routing.tunnels.ensure(record.id, peer));
      })
      .catch((err: unknown) => {
        routing.log("peer.tunnel.failed", {
          agentId: record.id,
          node,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  for (const record of await store.list()) track(record);

  const unsubscribe = store.onChange((change) => {
    if (change.type === "delete") forget(change.id);
    else track(change.record);
  });

  return {
    baseUrl(agentId) {
      const address = local.get(agentId) ?? remote.get(agentId);
      if (!address) throw new NoSandboxAddressError(agentId);
      return address;
    },
    localAddress: (agentId) => local.get(agentId) ?? null,
    stop: unsubscribe,
  };
}
