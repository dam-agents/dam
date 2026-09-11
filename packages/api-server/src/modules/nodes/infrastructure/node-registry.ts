import { readFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { nodes, eq, sql, type Db } from "db";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which nodes exist and which of them are alive.
 * Each api-server writes only its own row and no other, so the table has no
 * arbiter and cannot disagree with itself. Liveness is not a column: it is
 * computed from the heartbeat when the table is read, which means nothing has
 * to decide that a node has died and nothing can be wrong about it for longer
 * than one read.
 *
 * A node reports the capacity it is willing to lend to sandboxes, which is what
 * the machine has minus a reserve for the api-server, the gateways and the
 * kernel. Sandboxes are not the only thing on the node, so handing out all of
 * it would starve the thing doing the handing out.
 *
 * A node is only ever dialled by another node, and only to reach an agent it
 * holds, so `peerAddress` is the single address it publishes. Nothing in the
 * platform needs to know where a browser reaches it.
 */
export interface NodeRow {
  id: string;
  peerAddress: string;
  cpuMilli: number;
  memoryBytes: number;
  state: string;
  ready: boolean;
}

export interface NodeRegistry {
  register(): Promise<void>;
  heartbeat(): Promise<void>;
  list(): Promise<NodeRow[]>;
  ready(): Promise<NodeRow[]>;
}

const RESERVE_CPU_MILLI = 1000;
const RESERVE_MEMORY_BYTES = 1024 ** 3;

export interface NodeRegistryOpts {
  db: Db;
  nodeId: string;
  peerAddress: string;
  staleAfterMs: number;
}

export function createNodeRegistry(opts: NodeRegistryOpts): NodeRegistry {
  const capacity = async () => {
    const cpuMilli = Math.max(1000, cpus().length * 1000 - RESERVE_CPU_MILLI);
    const memoryBytes = Math.max(
      1024 ** 3,
      (await hostMemoryBytes()) - RESERVE_MEMORY_BYTES,
    );
    return { cpuMilli, memoryBytes };
  };

  const rows = async (): Promise<NodeRow[]> => {
    const now = Date.now();
    return (await opts.db.select().from(nodes)).map((row) => ({
      id: row.id,
      peerAddress: row.peerAddress,
      cpuMilli: row.capacityCpuMilli,
      memoryBytes: row.capacityMemoryBytes,
      state: row.state,
      ready:
        row.state === "ready" &&
        now - row.lastHeartbeat.getTime() < opts.staleAfterMs,
    }));
  };

  return {
    async register() {
      const { cpuMilli, memoryBytes } = await capacity();
      await opts.db
        .insert(nodes)
        .values({
          id: opts.nodeId,
          peerAddress: opts.peerAddress,
          capacityCpuMilli: cpuMilli,
          capacityMemoryBytes: memoryBytes,
          state: "ready",
        })
        .onConflictDoUpdate({
          target: nodes.id,
          set: {
            peerAddress: opts.peerAddress,
            capacityCpuMilli: cpuMilli,
            capacityMemoryBytes: memoryBytes,
            lastHeartbeat: new Date(),
          },
        });
    },

    async heartbeat() {
      await opts.db
        .update(nodes)
        .set({ lastHeartbeat: sql`now()` })
        .where(eq(nodes.id, opts.nodeId));
    },

    list: rows,

    async ready() {
      return (await rows()).filter((n) => n.ready);
    },
  };
}

async function hostMemoryBytes(): Promise<number> {
  const meminfo = await readFile("/proc/meminfo", "utf8").catch(() => "");
  const kb = /^MemTotal:\s+(\d+) kB/m.exec(meminfo)?.[1];
  return kb ? Number(kb) * 1024 : totalmem();
}
