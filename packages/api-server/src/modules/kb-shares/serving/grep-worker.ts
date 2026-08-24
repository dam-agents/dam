import { Worker } from "node:worker_threads";

import { globToMatcher } from "../domain/search-index.js";

export const GREP_DEADLINE_MS = 2000;
export const GREP_MAX_MATCHES = 200;

export interface GrepInputFile {
  path: string;
  text: string;
}

export interface GrepMatch {
  path: string;
  lineNumber: number;
  line: string;
  before: string[];
  after: string[];
}

export interface GrepOutcome {
  matches: GrepMatch[];
  truncated: boolean;
}

export class GrepPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrepPatternError";
  }
}

export class GrepDeadlineError extends Error {
  constructor() {
    super("grep exceeded its time budget");
    this.name = "GrepDeadlineError";
  }
}

const WORKER_SOURCE = `
(function main() {
  const { parentPort, workerData } = require("node:worker_threads");
  const { pattern, files, contextLines, maxMatches } = workerData;
  let regex;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    parentPort.postMessage({
      patternError: String(err && err.message ? err.message : err),
    });
    return;
  }
  const matches = [];
  let truncated = false;
  outer: for (const file of files) {
    const lines = file.text.split("\\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!regex.test(lines[i])) continue;
      matches.push({
        path: file.path,
        lineNumber: i + 1,
        line: lines[i],
        before: lines.slice(Math.max(0, i - contextLines), i),
        after: lines.slice(i + 1, i + 1 + contextLines),
      });
      if (matches.length >= maxMatches) {
        truncated = true;
        break outer;
      }
    }
  }
  parentPort.postMessage({ matches, truncated });
})();
`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: runs caller-supplied glob matching inside a
 * killable worker so the deadline can interrupt an adversarial glob that would
 * otherwise block the request thread for seconds. globToMatcher is a
 * self-contained pure function, so injecting its own source keeps a single
 * definition shared between the request thread and this worker.
 */
const GLOB_WORKER_SOURCE = `
(function main() {
  const { parentPort, workerData } = require("node:worker_threads");
  const { glob, paths } = workerData;
  const globToMatcher = ${globToMatcher.toString()};
  const match = globToMatcher(glob);
  const matched = [];
  for (const p of paths) {
    if (match(p)) matched.push(p);
  }
  parentPort.postMessage({ matched });
})();
`;

export function runGlobFilterWorker(input: {
  glob: string;
  paths: readonly string[];
  deadlineMs?: number;
}): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(GLOB_WORKER_SOURCE, {
      eval: true,
      workerData: { glob: input.glob, paths: input.paths },
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
      () => settle(() => reject(new GrepDeadlineError())),
      input.deadlineMs ?? GREP_DEADLINE_MS,
    );
    worker.once("message", (message: { matched: string[] }) => {
      settle(() => resolve(message.matched));
    });
    worker.once("error", (err) => settle(() => reject(err)));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        settle(() => reject(new GrepDeadlineError()));
      }
    });
  });
}

export function runGrepWorker(input: {
  pattern: string;
  files: readonly GrepInputFile[];
  contextLines: number;
  deadlineMs?: number;
}): Promise<GrepOutcome> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        pattern: input.pattern,
        files: input.files,
        contextLines: input.contextLines,
        maxMatches: GREP_MAX_MATCHES,
      },
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
      () => settle(() => reject(new GrepDeadlineError())),
      input.deadlineMs ?? GREP_DEADLINE_MS,
    );
    worker.once(
      "message",
      (message: GrepOutcome & { patternError?: string }) => {
        settle(() => {
          if (message.patternError) {
            reject(new GrepPatternError(message.patternError));
          } else {
            resolve({ matches: message.matches, truncated: message.truncated });
          }
        });
      },
    );
    worker.once("error", (err) => settle(() => reject(err)));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        settle(() => reject(new GrepDeadlineError()));
      }
    });
  });
}
