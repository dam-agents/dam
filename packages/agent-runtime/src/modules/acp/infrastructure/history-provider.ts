import { DEFAULT_EXPORT_NAME } from "./history-worker.js";
import { createWorkerCall } from "./worker-call.js";

export interface HistoryWindow {
  lines: string[];
  older: string | null;
}

export interface HistoryWindowAsk {
  frames: number;
  before?: string;
}

export interface HistoryProvider {
  fetch(sessionId: string): Promise<string[] | null>;
  window?(
    sessionId: string,
    ask: HistoryWindowAsk,
  ): Promise<HistoryWindow | null>;
  warm?(): void;
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

export interface WorkerHistoryProviderDeps {
  modulePath: string;
  exportName?: string;
  timeoutMs?: number;
  log: (msg: string) => void;
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
 * `window` asks the same export for part of the conversation, `{ sessionId,
 * frames, before? }`, and expects `{ lines, older }`: the newest part, or the
 * part before an earlier answer's `older` cursor, and the cursor of the part
 * before it. A module that answers a window with every frame has answered the
 * whole conversation, with nothing older.
 */
export function createWorkerHistoryProvider(
  deps: WorkerHistoryProviderDeps,
): HistoryProvider {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const worker = createWorkerCall({
    modulePath: deps.modulePath,
    exportName: deps.exportName ?? DEFAULT_EXPORT_NAME,
    label: "history provider",
    log: deps.log,
  });
  const linesOf = (sessionId: string, result: unknown): string[] | null => {
    if (!Array.isArray(result)) return null;
    const lines = validateLines(sessionId, result as string[]);
    if (lines === null)
      deps.log(`history provider for ${sessionId}: emitted an invalid frame`);
    return lines;
  };
  return {
    warm: () => worker.warm(),
    async window(sessionId, ask) {
      const outcome = await worker.call(
        {
          sessionId,
          frames: ask.frames,
          ...(ask.before !== undefined && { before: ask.before }),
        },
        timeoutMs,
      );
      if (!outcome.ok) {
        deps.log(`history provider for ${sessionId}: ${outcome.error}`);
        return null;
      }
      if (Array.isArray(outcome.result)) {
        const lines = linesOf(sessionId, outcome.result);
        return lines === null ? null : { lines, older: null };
      }
      const answer = outcome.result as {
        lines?: unknown;
        older?: unknown;
      } | null;
      const lines = linesOf(sessionId, answer?.lines);
      if (lines === null) return null;
      return {
        lines,
        older: typeof answer?.older === "string" ? answer.older : null,
      };
    },
    async fetch(sessionId) {
      const outcome = await worker.call(sessionId, timeoutMs);
      if (!outcome.ok) {
        deps.log(`history provider for ${sessionId}: ${outcome.error}`);
        return null;
      }
      return linesOf(sessionId, outcome.result);
    },
  };
}
