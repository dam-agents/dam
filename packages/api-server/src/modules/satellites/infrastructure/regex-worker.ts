import { Worker } from "node:worker_threads";

import type { RegexOracle } from "api-server-api";

export const REGEX_DEADLINE_MS = 250;

export class RegexDeadlineError extends Error {
  constructor() {
    super("a command pattern's regex exceeded its time budget");
    this.name = "RegexDeadlineError";
  }
}

const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
const compiled = new Map();
parentPort.on("message", (job) => {
  const bits = new Uint8Array(job.sources.length * job.argv.length);
  for (let s = 0; s < job.sources.length; s++) {
    const source = job.sources[s];
    let regex = compiled.get(source);
    if (regex === undefined) {
      try {
        regex = new RegExp(source);
      } catch {
        regex = null;
      }
      compiled.set(source, regex);
    }
    if (regex === null) continue;
    for (let v = 0; v < job.argv.length; v++)
      if (regex.test(job.argv[v])) bits[s * job.argv.length + v] = 1;
  }
  parentPort.postMessage({ id: job.id, bits }, [bits.buffer]);
});
parentPort.postMessage({ ready: true });
`;

interface Pending {
  resolve: (bits: Uint8Array) => void;
  reject: (err: Error) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Evaluates a Manifest's regexes against a command
 * off the event loop, under a deadline. The regex is written by a Satellite's
 * owner and the value comes from an Agent, so a pattern like a nested quantifier
 * meeting a long argument backtracks for longer than anyone will wait. On the
 * machine that is the owner's own problem, but the api-server matches too, and
 * there it would stall every other request in the process. A thread can be
 * abandoned; a regex on this thread cannot.
 *
 * The thread is started once and reused, because starting one costs more than
 * the deadline it is meant to enforce — a fresh thread per command spent the
 * budget on its own startup and refused patterns that match in microseconds.
 * The deadline is armed only once the thread has reported ready, so it is
 * charged to the matching alone. Sources and arguments cross the boundary as
 * two lists rather than as every pair, and each distinct source is compiled
 * once and kept for later commands.
 *
 * Known ceiling: one thread serves the whole replica and evaluates one command
 * at a time, so a command waits behind whatever is already matching. That is
 * bounded by the deadline and is the reason abandoning is safe — terminating
 * the thread cannot hit a bystander. A pool keyed by owner is the upgrade path
 * if matching ever shows up in request latency.
 */
export function createRegexEvaluator(deadlineMs = REGEX_DEADLINE_MS) {
  let worker: Worker | null = null;
  let ready: Promise<Worker> | null = null;
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let queue: Promise<unknown> = Promise.resolve();

  function discard(err: Error): void {
    for (const waiter of pending.values()) waiter.reject(err);
    pending.clear();
    worker?.removeAllListeners();
    void worker?.terminate();
    worker = null;
    ready = null;
  }

  function start(): Promise<Worker> {
    if (ready !== null) return ready;
    ready = new Promise<Worker>((resolve, reject) => {
      const started = new Worker(WORKER_SOURCE, { eval: true });
      started.unref();
      started.on("message", (message: { id?: number; bits?: Uint8Array }) => {
        if (message.id === undefined) {
          worker = started;
          resolve(started);
          return;
        }
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        waiter?.resolve(message.bits ?? new Uint8Array());
      });
      started.on("error", (err) => {
        reject(err);
        discard(err);
      });
      started.on("exit", () => {
        if (worker === started) discard(new Error("regex worker exited"));
      });
    });
    return ready;
  }

  async function evaluate(
    sources: string[],
    argv: string[],
  ): Promise<Uint8Array> {
    if (sources.length === 0) return new Uint8Array();
    const running = await start();
    const id = nextId++;
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        discard(new RegexDeadlineError());
      }, deadlineMs);
      const done = (fn: () => void): void => {
        clearTimeout(timer);
        fn();
      };
      pending.set(id, {
        resolve: (bits) => done(() => resolve(bits)),
        reject: (err) => done(() => reject(err)),
      });
      running.postMessage({ id, sources, argv });
    });
  }

  return {
    async oracleFor(sources: string[], argv: string[]): Promise<RegexOracle> {
      const serialized = queue.then(
        () => evaluate(sources, argv),
        () => evaluate(sources, argv),
      );
      queue = serialized.catch(() => undefined);
      const bits = await serialized;
      const at = new Map(sources.map((source, index) => [source, index]));
      const of = new Map(argv.map((value, index) => [value, index]));
      return (source, value) => {
        const s = at.get(source);
        const v = of.get(value);
        return s === undefined || v === undefined
          ? false
          : bits[s * argv.length + v] === 1;
      };
    },
    async stop(): Promise<void> {
      discard(new Error("regex worker stopped"));
    },
  };
}

export type RegexEvaluator = ReturnType<typeof createRegexEvaluator>;
