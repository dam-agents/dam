import { layoutFor } from "../../sandboxes/domain/layout.js";
import { importWorkspace } from "../../sandboxes/infrastructure/workspace-transfer.js";
import {
  openPeerStream,
  type PeerCredentials,
} from "../infrastructure/peer-link.js";
import type { NodeRegistry } from "../infrastructure/node-registry.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Brings an agent's workspace to the node that is
 * about to run it. The record names the node whose disk holds it, so there is
 * exactly one place to ask and no question of which copy is current.
 *
 * A node that already holds it does nothing, which is what keeps a reconcile
 * from re-fetching on every sweep. A node that is gone is an error rather than
 * a fresh empty workspace: the agent is not startable until that node returns,
 * and saying so is better than quietly handing someone an empty directory and
 * calling it their project.
 */
export interface WorkspaceCourier {
  fetch(record: { id: string; lastNode: string | null }): Promise<boolean>;
}

export function createWorkspaceCourier(opts: {
  nodeId: string;
  agentsRoot: string;
  registry: NodeRegistry;
  credentials: PeerCredentials;
  log: (message: string, fields?: Record<string, unknown>) => void;
}): WorkspaceCourier {
  return {
    async fetch(record) {
      const from = record.lastNode;
      if (!from || from === opts.nodeId) return false;

      const peer = (await opts.registry.list()).find((n) => n.id === from);
      if (!peer) {
        throw new Error(`node ${from} holds the workspace and is gone`);
      }

      opts.log("workspace.fetch.begin", { agentId: record.id, from });
      const stream = await openPeerStream({
        peerAddress: peer.peerAddress,
        credentials: opts.credentials,
        verb: "export",
        agentId: record.id,
      });
      await importWorkspace(layoutFor(opts.agentsRoot, record.id).root, stream);
      opts.log("workspace.fetch.done", { agentId: record.id, from });
      return true;
    },
  };
}
