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
import { parseQuantity } from "../../../core/quantity.js";
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
 * A per-user ceiling is enforced here for the same reason placement is: this
 * is the one writer, so it is the one place where "would this exceed it" has a
 * single answer. Enforcing it at the API instead would let two requests that
 * each fit pass together, and enforcing it in a node's supervisor would give
 * every node a different opinion about a ceiling that is install-wide. An
 * agent over the ceiling is left unplaced and says so, which is what makes it
 * recoverable: nothing is refused permanently, it starts when the owner frees
 * room.
 *
 * Which of an owner's agents gets the last of their allowance is whichever the
 * records come back in front of. There is no fairer order to pick and pretending
 * otherwise would mean sorting by something arbitrary and calling it policy.
 *
 * When it cannot place an agent that wants to run it says so on the record,
 * because otherwise nothing does: the agent reads as coming up for as long as
 * anyone watches it. The message distinguishes a node that would fit if
 * something freed up from a demand no node in the install could ever meet,
 * since one is worth waiting for and the other is not.
 *
 * It is also the only thing that can say an agent no node holds is at rest.
 * Status is published by the supervisor that ran the agent and stays
 * published; an agent that fits nowhere, or that arrived in the database from
 * a migration and was never placed, is run by nobody, and nobody is then left
 * to say so. Without that it reads as starting for ever — a stop request has
 * no supervisor to act on it — which is a claim that something is coming up
 * when nothing is. It converges in one write and is then silent.
 *
 * A complaint about capacity left on a resting agent counts as not yet settled,
 * so it is cleared on the next pass however it got there. The state machine
 * reads that complaint ahead of rest, because an agent somebody has just asked
 * for is not resting; the cost of that choice is that a stale one would read as
 * a live one, and this is what stops one being stale.
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
  ceilingFor: (owner: string) => Promise<{ cpu: string; memory: string }>;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

const gi = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} Gi`;
const cores = (milli: number) => String(Number((milli / 1000).toFixed(2)));

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether one more agent would take an owner past
 * their ceiling, and what to tell them if it would. The message names the
 * dimension that actually ran out, because "you are over your budget" leaves a
 * person guessing which of two numbers to act on.
 */
function overCeiling(
  held: NodeLoad,
  want: NodeLoad,
  ceiling: { cpu: string; memory: string },
): string | null {
  const ceilCpu = Math.round((parseQuantity(ceiling.cpu) ?? 0) * 1000);
  const ceilMemory = Math.round(parseQuantity(ceiling.memory) ?? 0);
  if (ceilCpu > 0 && held.cpuMilli + want.cpuMilli > ceilCpu) {
    return `Starting this agent would take you to ${cores(held.cpuMilli + want.cpuMilli)} of ${cores(ceilCpu)} CPU. Stop or pause another agent to free room.`;
  }
  if (ceilMemory > 0 && held.memoryBytes + want.memoryBytes > ceilMemory) {
    return `Starting this agent would take you to ${gi(held.memoryBytes + want.memoryBytes)} of ${gi(ceilMemory)} memory. Stop or pause another agent to free room.`;
  }
  return null;
}

function noRoomMessage(
  want: NodeLoad,
  capacities: readonly { memoryBytes: number }[],
): string {
  const largest = capacities.reduce((a, n) => Math.max(a, n.memoryBytes), 0);
  if (capacities.length === 0) {
    return "No node is available to run this agent.";
  }
  return want.memoryBytes > largest
    ? `This agent asks for ${gi(want.memoryBytes)} of memory and the largest node has ${gi(largest)}. It cannot start until an operator adds a bigger node.`
    : `No node has ${gi(want.memoryBytes)} of memory free. This agent starts as soon as room frees up.`;
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
    const held = new Map<string, NodeLoad>();
    const chargeOwner = (owner: string, want: NodeLoad) => {
      const at = held.get(owner) ?? { ...EMPTY_LOAD };
      at.cpuMilli += want.cpuMilli;
      at.memoryBytes += want.memoryBytes;
      held.set(owner, at);
    };
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
      if (
        !running &&
        !record.assignedNode &&
        (!record.status.hibernated ||
          record.status.noCapacityMessage ||
          record.status.overBudget)
      ) {
        await opts.store.writeStatus(record.id, {
          ready: false,
          hibernated: true,
          hibernatedSince: new Date().toISOString(),
          address: "",
          sandboxReady: false,
          gatewayReady: false,
          noCapacityMessage: "",
          overBudget: false,
          overBudgetMessage: "",
        });
        opts.log("placement.at-rest", { agentId: record.id });
        continue;
      }
      if (record.assignedNode) {
        const want = demandOf(record.spec.resources?.limits);
        add(record.assignedNode, want);
        chargeOwner(record.owner, want);
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

      const ceiling = await opts.ceilingFor(record.owner);
      const over = overCeiling(
        held.get(record.owner) ?? EMPTY_LOAD,
        want,
        ceiling,
      );
      if (over) {
        if (!record.status.overBudget) {
          await opts.store.writeStatus(record.id, {
            overBudget: true,
            overBudgetMessage: over,
          });
        }
        opts.log("placement.over-budget", { agentId: record.id });
        continue;
      }

      const node = choosePlacement({
        ready: capacities,
        loadOf: (id) => load.get(id) ?? EMPTY_LOAD,
        want,
        preferred: record.lastNode,
      });
      if (!node) {
        const message = noRoomMessage(want, capacities);
        if (record.status.noCapacityMessage !== message) {
          await opts.store.writeStatus(record.id, {
            noCapacityMessage: message,
          });
        }
        opts.log("placement.no-capacity", { agentId: record.id, ...want });
        continue;
      }
      await opts.store.assign(record.id, node);
      if (record.status.noCapacityMessage || record.status.overBudget) {
        await opts.store.writeStatus(record.id, {
          noCapacityMessage: "",
          overBudget: false,
          overBudgetMessage: "",
        });
      }
      add(node, want);
      chargeOwner(record.owner, want);
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
