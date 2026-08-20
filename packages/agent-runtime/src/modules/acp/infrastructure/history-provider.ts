import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";

export interface HistoryProvider {
  fetch(sessionId: string): Promise<string[] | null>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function validateLines(
  sessionId: string,
  lines: readonly string[],
): string[] | null {
  const valid: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      return null;
    }
    const f = frame as { method?: unknown; params?: { sessionId?: unknown } };
    if (f.method !== "session/update" || f.params?.sessionId !== sessionId) {
      return null;
    }
    valid.push(line);
  }
  return valid;
}

export interface ExecHistoryProviderDeps {
  command: readonly string[];
  cwd: string;
  timeoutMs?: number;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs the harness image's declared session-history
 * command (runtime-manifest `sessionHistory.command`) to read one session's
 * replay without touching the harness process. The command receives the
 * session id as its final argument and must print one `session/update`
 * JSON-RPC frame per line for that session. Any deviation — non-zero exit,
 * timeout, malformed or foreign frames — resolves to null so the caller falls
 * back to the harness `session/load`; the provider accelerates, it never
 * decides.
 */
export function createExecHistoryProvider(
  deps: ExecHistoryProviderDeps,
): HistoryProvider {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    fetch(sessionId) {
      return new Promise((resolve) => {
        const [bin, ...args] = deps.command;
        if (!bin) {
          resolve(null);
          return;
        }
        const child = spawn(bin, [...args, sessionId], {
          cwd: deps.cwd,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (lines: string[] | null, reason?: string): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (reason) deps.log(`history provider for ${sessionId}: ${reason}`);
          resolve(lines);
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(null, `timed out after ${timeoutMs}ms`);
        }, timeoutMs);
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", (error) =>
          finish(null, `failed to start: ${error.message}`),
        );
        child.on("close", (code) => {
          if (code !== 0) {
            finish(null, `exited ${code}: ${stderr.trim().slice(0, 200)}`);
            return;
          }
          const lines = validateLines(sessionId, stdout.split("\n"));
          if (lines === null) {
            finish(null, "emitted an invalid frame");
            return;
          }
          finish(lines);
        });
      });
    },
  };
}

const WORKER_BOOTSTRAP = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const mod = await import(workerData.moduleUrl);
  const fn = mod[workerData.exportName] ?? mod.default;
  if (typeof fn !== "function") {
    throw new Error("export " + workerData.exportName + " is not a function");
  }
  parentPort.on("message", async (msg) => {
    try {
      const lines = await fn(msg.sessionId);
      parentPort.postMessage({ id: msg.id, lines });
    } catch (error) {
      parentPort.postMessage({
        id: msg.id,
        error: String((error && error.message) || error),
      });
    }
  });
  parentPort.postMessage({ ready: true });
})().catch((error) => {
  parentPort.postMessage({
    fatal: String((error && error.message) || error),
  });
});
`;

export interface WorkerHistoryProviderDeps {
  modulePath: string;
  exportName?: string;
  timeoutMs?: number;
  log: (msg: string) => void;
}

interface WorkerHandle {
  worker: Worker;
  ready: Promise<boolean>;
  inFlight: Map<number, (lines: string[] | null) => void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Hosts the harness image's declared session-history
 * module (runtime-manifest `sessionHistory.module`) in one persistent worker
 * thread, so the module graph is compiled once instead of per load. The
 * module's exported function receives a session id and resolves to an array
 * of `session/update` JSON-RPC frame strings for that session. The worker is
 * spawned lazily, and any failure — spawn, import, per-request error, crash,
 * timeout, invalid frames — resolves that fetch to null so the caller falls
 * back to the harness `session/load`; a dead worker is respawned on the next
 * fetch.
 */
export function createWorkerHistoryProvider(
  deps: WorkerHistoryProviderDeps,
): HistoryProvider {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exportName = deps.exportName ?? "loadHistory";
  let handle: WorkerHandle | null = null;
  let nextId = 1;

  function ensureWorker(): WorkerHandle {
    if (handle) return handle;
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: {
        moduleUrl: deps.modulePath.startsWith("data:")
          ? deps.modulePath
          : new URL(`file://${deps.modulePath}`).href,
        exportName,
      },
    });
    worker.unref();
    const inFlight = new Map<number, (lines: string[] | null) => void>();
    const created: WorkerHandle = {
      worker,
      inFlight,
      ready: new Promise<boolean>((resolve) => {
        const onFirst = (msg: { ready?: boolean; fatal?: string }): void => {
          if (msg.ready === true) {
            resolve(true);
            return;
          }
          if (msg.fatal !== undefined) {
            deps.log(`history provider module failed to load: ${msg.fatal}`);
            resolve(false);
            return;
          }
        };
        worker.once("message", onFirst);
        worker.once("error", (error) => {
          deps.log(`history provider worker error: ${error.message}`);
          resolve(false);
        });
      }),
    };
    worker.on(
      "message",
      (msg: { id?: number; lines?: unknown; error?: string }) => {
        if (typeof msg.id !== "number") return;
        const settle = inFlight.get(msg.id);
        if (!settle) return;
        inFlight.delete(msg.id);
        if (msg.error !== undefined || !Array.isArray(msg.lines)) {
          if (msg.error !== undefined) {
            deps.log(`history provider module: ${msg.error}`);
          }
          settle(null);
          return;
        }
        settle(msg.lines as string[]);
      },
    );
    const dropWorker = (): void => {
      if (handle === created) handle = null;
      for (const settle of inFlight.values()) settle(null);
      inFlight.clear();
    };
    worker.on("error", dropWorker);
    worker.on("exit", dropWorker);
    handle = created;
    return created;
  }

  return {
    async fetch(sessionId) {
      const current = ensureWorker();
      const ok = await current.ready;
      if (!ok) {
        if (handle === current) handle = null;
        return null;
      }
      const id = nextId++;
      const raw = await new Promise<string[] | null>((resolve) => {
        const timer = setTimeout(() => {
          current.inFlight.delete(id);
          deps.log(
            `history provider for ${sessionId}: timed out after ${timeoutMs}ms`,
          );
          resolve(null);
        }, timeoutMs);
        current.inFlight.set(id, (lines) => {
          clearTimeout(timer);
          resolve(lines);
        });
        current.worker.postMessage({ id, sessionId });
      });
      if (raw === null) return null;
      const lines = validateLines(sessionId, raw);
      if (lines === null) {
        deps.log(`history provider for ${sessionId}: emitted an invalid frame`);
        return null;
      }
      return lines;
    },
  };
}
