import { availableParallelism } from "node:os";

const QUEUE_WAIT_MS = 2000;
export const WORKER_CAPACITY = Math.max(
  1,
  Math.min(4, availableParallelism() - 2),
);
const GLOBAL_CAPACITY = WORKER_CAPACITY * 2;
const PER_SHARE_CAPACITY = 4;

export class QueryBusyError extends Error {
  constructor() {
    super("busy — retry shortly");
    this.name = "QueryBusyError";
  }
}

interface Gate {
  inFlight: number;
  waiters: { resolve: () => void; timer: NodeJS.Timeout }[];
}

function acquireGate(gate: Gate, capacity: number): Promise<void> {
  if (gate.inFlight < capacity) {
    gate.inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve: () => {
        gate.inFlight += 1;
        resolve();
      },
      timer: setTimeout(() => {
        const index = gate.waiters.indexOf(waiter);
        if (index >= 0) gate.waiters.splice(index, 1);
        reject(new QueryBusyError());
      }, QUEUE_WAIT_MS),
    };
    gate.waiters.push(waiter);
  });
}

function releaseGate(gate: Gate): void {
  gate.inFlight -= 1;
  const next = gate.waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
  }
}

export interface QueryLimits {
  withSlot<T>(shareId: string, task: () => Promise<T>): Promise<T>;
}

export function createQueryLimits(): QueryLimits {
  const global: Gate = { inFlight: 0, waiters: [] };
  const perShare = new Map<string, Gate>();

  function shareGate(shareId: string): Gate {
    let gate = perShare.get(shareId);
    if (!gate) {
      gate = { inFlight: 0, waiters: [] };
      perShare.set(shareId, gate);
    }
    return gate;
  }

  function dropShareGateIfIdle(shareId: string, gate: Gate): void {
    if (gate.inFlight === 0 && gate.waiters.length === 0) {
      perShare.delete(shareId);
    }
  }

  return {
    async withSlot(shareId, task) {
      const share = shareGate(shareId);
      await acquireGate(share, PER_SHARE_CAPACITY);
      try {
        await acquireGate(global, GLOBAL_CAPACITY);
      } catch (err) {
        releaseGate(share);
        dropShareGateIfIdle(shareId, share);
        throw err;
      }
      try {
        return await task();
      } finally {
        releaseGate(global);
        releaseGate(share);
        dropShareGateIfIdle(shareId, share);
      }
    },
  };
}
