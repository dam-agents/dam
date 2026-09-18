import { Worker } from "node:worker_threads";

import type { RegexProbe } from "api-server-api";

export const REGEX_DEADLINE_MS = 250;

export class RegexDeadlineError extends Error {
  constructor() {
    super("a command pattern's regex exceeded its time budget");
    this.name = "RegexDeadlineError";
  }
}

const WORKER_SOURCE = `
(function main() {
  const { parentPort, workerData } = require("node:worker_threads");
  const results = [];
  for (const probe of workerData.probes) {
    try {
      results.push(new RegExp(probe.source).test(probe.value));
    } catch {
      results.push(false);
    }
  }
  parentPort.postMessage({ results });
})();
`;

const SEPARATOR = String.fromCharCode(0);

function key(source: string, value: string): string {
  return `${source}${SEPARATOR}${value}`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Evaluates a Manifest's regexes against a command
 * off the event loop, with a deadline. The regex is written by a Satellite's
 * owner and the value comes from an Agent, so a pattern like a nested quantifier
 * meeting a long argument backtracks for longer than anyone will wait. On the
 * machine that is the owner's own problem, but the api-server matches too, and
 * there it would stall every other request in the process. A thread can be
 * abandoned; a regex on this thread cannot.
 */
export async function evaluateRegexProbes(
  probes: readonly RegexProbe[],
  deadlineMs = REGEX_DEADLINE_MS,
): Promise<Map<string, boolean>> {
  const table = new Map<string, boolean>();
  if (probes.length === 0) return table;

  const results = await new Promise<boolean[]>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { probes },
    });
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      void worker.terminate();
      fn();
    };
    const deadline = setTimeout(
      () => settle(() => reject(new RegexDeadlineError())),
      deadlineMs,
    );
    worker.once("message", (message: { results: boolean[] }) =>
      settle(() => resolve(message.results)),
    );
    worker.once("error", (err) => settle(() => reject(err)));
    worker.once("exit", (code) => {
      if (!settled && code !== 0)
        settle(() => reject(new RegexDeadlineError()));
    });
  });

  probes.forEach((probe, index) => {
    table.set(key(probe.source, probe.value), results[index] ?? false);
  });
  return table;
}

export function oracleFor(
  table: Map<string, boolean>,
): (source: string, value: string) => boolean {
  return (source, value) => table.get(key(source, value)) ?? false;
}
