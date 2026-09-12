import type {
  AgentRecord,
  AgentStore,
} from "../../agents/infrastructure/agent-store.js";
import {
  effectiveIdleTimeoutMs,
  shouldRun,
} from "../../sandboxes/domain/hibernation.js";
import {
  choosePlacement,
  demandOf,
  EMPTY_LOAD,
  type NodeLoad,
} from "../domain/placement.js";
import type { NodeRegistry } from "../infrastructure/node-registry.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Assigns agents to nodes, and is the only writer of
 * that assignment. It runs on the elected node alone — two schedulers would
 * place the same agent twice and two supervisors would build it twice.
 *
 * It does two things and nothing else: give a node to an agent that wants to
 * run and has none, and take the node back from one that has stopped wanting
 * to. Releasing on hibernation is what makes the next wake a fresh placement
 * decision, which is where load balancing actually happens.
 *
 * It is also the only thing that can say an agent no node holds is at rest.
 * Status is published by the supervisor that ran the agent and stays
 * published; an agent that fits nowhere, or that arrived in the database from
 * a migration and was never placed, is run by nobody, and nobody is then left
 * to say so. Without that it reads as starting for ever — a stop request has
 * no supervisor to act on it — which is a claim that something is coming up
 * when nothing is. It converges in one write and is then silent.
 *
 * An agent still wanting to run on a node that has stopped heartbeating keeps
 * its assignment. Its workspace is on that node's disk, so placing it
 * elsewhere would start it on an empty one; it reads as not running until the
 * node comes back, and moving it is a decision for an operator. One that goes
 * idle meanwhile is released like any other, and its next wake is placed
 * wherever it fits — which fails loudly at the fetch while the node holding
 * its workspace is away, rather than quietly starting it with nothing.
 */
export interface Scheduler {
  tick(): Promise<void>;
  scheduleSoon(): void;
  stop(): void;
}

export interface SchedulerOpts {
  store: AgentStore;
  registry: NodeRegistry;
  defaultIdleTimeoutMs: number;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

export function createScheduler(opts: SchedulerOpts): Scheduler {
  let queued: NodeJS.Timeout | null = null;
  let running = false;
  let again = false;

  const wants = (record: AgentRecord, now: Date) =>
    shouldRun(
      record.annotations,
      effectiveIdleTimeoutMs(
        record.spec.hibernationTimeout,
        opts.defaultIdleTimeoutMs,
      ),
      now,
    );

  async function pass(): Promise<void> {
    const [records, ready] = await Promise.all([
      opts.store.list(),
      opts.registry.ready(),
    ]);
    const now = new Date();
    const load = new Map<string, NodeLoad>();
    const add = (nodeId: string, want: NodeLoad) => {
      const at = load.get(nodeId) ?? { ...EMPTY_LOAD };
      at.cpuMilli += want.cpuMilli;
      at.memoryBytes += want.memoryBytes;
      load.set(nodeId, at);
    };

    const unplaced: AgentRecord[] = [];
    for (const record of records) {
      const running = wants(record, now);
      if (record.assignedNode && !running) {
        await opts.store.assign(record.id, null);
        opts.log("placement.released", {
          agentId: record.id,
          node: record.assignedNode,
        });
        continue;
      }
      if (!running && !record.assignedNode && !record.status.hibernated) {
        await opts.store.writeStatus(record.id, {
          ready: false,
          hibernated: true,
          hibernatedSince: new Date().toISOString(),
          address: "",
          sandboxReady: false,
          gatewayReady: false,
        });
        opts.log("placement.at-rest", { agentId: record.id });
        continue;
      }
      if (record.assignedNode) {
        add(record.assignedNode, demandOf(record.spec.resources?.limits));
      } else if (running) {
        unplaced.push(record);
      }
    }

    const capacities = ready.map((n) => ({
      id: n.id,
      cpuMilli: n.cpuMilli,
      memoryBytes: n.memoryBytes,
    }));
    for (const record of unplaced) {
      const want = demandOf(record.spec.resources?.limits);
      const node = choosePlacement({
        ready: capacities,
        loadOf: (id) => load.get(id) ?? EMPTY_LOAD,
        want,
        preferred: record.lastNode,
      });
      if (!node) {
        opts.log("placement.no-capacity", { agentId: record.id, ...want });
        continue;
      }
      await opts.store.assign(record.id, node);
      add(node, want);
      opts.log("placement.assigned", { agentId: record.id, node });
    }
  }

  async function tick(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await pass();
      } while (again);
    } catch (err) {
      opts.log("placement.failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  }

  return {
    tick,

    scheduleSoon(): void {
      if (queued) return;
      queued = setTimeout(() => {
        queued = null;
        void tick();
      }, 100);
      queued.unref();
    },

    stop(): void {
      if (queued) clearTimeout(queued);
      queued = null;
    },
  };
}
