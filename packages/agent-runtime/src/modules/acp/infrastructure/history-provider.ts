import { describeFailure, runOnce } from "../../../core/run-once.js";
import {
  DEFAULT_EXPORT_NAME,
  startWorker,
  takePrestartedWorker,
  type StartedWorker,
} from "./history-worker.js";

export interface HistoryProvider {
  fetch(sessionId: string): Promise<string[] | null>;
  warm?(): void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

const MAX_EXEC_OUTPUT_BYTES = 32 * 1024 * 1024;

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
  maxOutputBytes?: number;
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
  const maxOutputBytes = deps.maxOutputBytes ?? MAX_EXEC_OUTPUT_BYTES;
  return {
    async fetch(sessionId) {
      if (deps.command.length === 0) {
        deps.log(`history provider for ${sessionId}: no command declared`);
        return null;
      }
      const command = [...deps.command, sessionId];
      const result = await runOnce({
        command,
        cwd: deps.cwd,
        timeoutMs,
        maxOutputBytes,
      });
      if (!result.ok) {
        deps.log(
          `history provider for ${sessionId}: ${describeFailure(command.join(" "), result.error)}`,
        );
        return null;
      }
      const lines = validateLines(sessionId, result.value.stdout.split("\n"));
      if (lines === null) {
        deps.log(`history provider for ${sessionId}: emitted an invalid frame`);
        return null;
      }
      return lines;
    },
  };
}

export interface WorkerHistoryProviderDeps {
  modulePath: string;
  exportName?: string;
  timeoutMs?: number;
  log: (msg: string) => void;
}

interface WorkerHandle extends StartedWorker {
  inFlight: Map<number, (lines: string[] | null) => void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Hosts the harness image's declared session-history
 * module (runtime-manifest `sessionHistory.module`) in one persistent worker
 * thread, so the module graph is compiled once instead of per load. The
 * module's exported function receives a session id and resolves to an array
 * of `session/update` JSON-RPC frame strings for that session. The worker is
 * the one the runtime's entry point started for this module, or else spawned
 * by `warm`, which the server calls once it listens, or by the first fetch.
 * Any failure — spawn, import, per-request error, crash, timeout, invalid
 * frames — resolves that fetch to null so the caller falls back to the
 * harness `session/load`; a dead worker is respawned on the next fetch.
 */
export function createWorkerHistoryProvider(
  deps: WorkerHistoryProviderDeps,
): HistoryProvider {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exportName = deps.exportName ?? DEFAULT_EXPORT_NAME;
  let handle: WorkerHandle | null = null;
  let nextId = 1;

  function ensureWorker(): WorkerHandle {
    if (handle) return handle;
    const started =
      takePrestartedWorker(deps.modulePath, exportName) ??
      startWorker(deps.modulePath, exportName, deps.log);
    const { worker } = started;
    const inFlight = new Map<number, (lines: string[] | null) => void>();
    const created: WorkerHandle = { ...started, inFlight };
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
    warm: () => void ensureWorker(),
    async fetch(sessionId) {
      const current = ensureWorker();
      const ok = await current.ready;
      if (!ok) {
        if (handle === current) handle = null;
        void current.worker.terminate();
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
