import type { AgentStore } from "./agent-store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where each running sandbox answers. The
 * supervisor allocates the address and publishes it on the agent's status; this
 * keeps a synchronous view of that, so relays and clients can build a URL
 * without a round trip. An agent with no address is not running, and saying so
 * loudly beats a connection that hangs.
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
  stop(): void;
}

export async function startSandboxAddresses(
  store: AgentStore,
  port: number,
): Promise<RunningSandboxAddresses> {
  const byId = new Map<string, string>();

  const remember = (id: string, address: string | undefined) => {
    if (address) byId.set(id, address);
    else byId.delete(id);
  };

  for (const record of await store.list()) {
    remember(record.id, record.status.address);
  }

  const unsubscribe = store.onChange((change) => {
    if (change.type === "delete") byId.delete(change.id);
    else remember(change.id, change.record.status.address);
  });

  return {
    baseUrl(agentId) {
      const address = byId.get(agentId);
      if (!address) throw new NoSandboxAddressError(agentId);
      return `${address}:${port}`;
    },
    stop: unsubscribe,
  };
}
