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
 * Liveness is decided by the database's clock and no other. The heartbeat, the
 * registration that refreshes it and the comparison that reads it all used a
 * different one — the row was stamped by whichever node wrote it and judged
 * against the clock of whichever node read it — so a node drifting past the
 * staleness window read every node in the install as dead, the scheduler runs
 * on exactly one node, and placement stopped for everyone with nothing saying
 * why. `now()` on both sides of the comparison makes the drift unobservable
 * rather than fatal, and costs a clause.
 *
 * A node reports the capacity it is willing to lend to sandboxes, which is what
 * the machine has minus a reserve for the api-server, the gateways and the
 * kernel. Sandboxes are not the only thing on the node, so handing out all of
 * it would starve the thing doing the handing out.
 *
 * A node is only ever dialled by another node, and only to reach an agent it
 * holds, so `peerAddress` is the single address it publishes. Nothing in the
 * platform needs to know where a browser reaches it.
 *
 * Heartbeating is a node's own business and has to run on the node's own
 * clock. The install's periodic-job queue is the opposite arrangement — it
 * exists to make work happen once across every node — so a heartbeat put on it
 * refreshes whichever node's worker received the tick and leaves every other
 * node to go stale while it is running perfectly, dropping out of placement
 * for a reason nothing reports.
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
  capacity(): Promise<{ cpuMilli: number; memoryBytes: number }>;
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
    const staleAfterSeconds = opts.staleAfterMs / 1000;
    const selected = await opts.db
      .select({
        id: nodes.id,
        peerAddress: nodes.peerAddress,
        cpuMilli: nodes.capacityCpuMilli,
        memoryBytes: nodes.capacityMemoryBytes,
        state: nodes.state,
        beating: sql<boolean>`${nodes.lastHeartbeat} > now() - ${staleAfterSeconds}::double precision * interval '1 second'`,
      })
      .from(nodes);
    return selected.map(({ beating, ...row }) => ({
      ...row,
      ready: row.state === "ready" && beating,
    }));
  };

  return {
    capacity,

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
            lastHeartbeat: sql`now()`,
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
