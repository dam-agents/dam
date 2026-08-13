// One registry for work still running: a session's report, or an agent's declaration.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { BackgroundWorkItem } from "agent-runtime-api";
import type { DocumentStoreBackend } from "../core/document-store.js";
import { readProcessEntry } from "../core/process-table.js";

/** `""` when unreadable, which disables the check rather than wiping the store —
 *  and is never persisted, or a later readable boot would look like a new one. */
let cachedBootId: string | undefined;
function bootId(): string {
  try {
    return (cachedBootId ??= readFileSync(
      "/proc/sys/kernel/random/boot_id",
      "utf8",
    ).trim());
  } catch {
    return (cachedBootId ??= "");
  }
}

/** Truncated, never rejected: a cap that can fail the request would drop the
 *  declaration over the length of a label, and the work with it. */
const advisory = (max: number) =>
  z
    .string()
    .transform((text) => text.slice(0, max))
    .optional();

/** Bounded like an advisory field but dropped whole, never clipped: a truncated
 *  path looks well-formed and opens nothing, and this is the durable record of
 *  where detached output went. */
const identifier = (max: number) =>
  z
    .string()
    .transform((value) => (value.length > max ? undefined : value))
    .optional();

const stamp = (): { bootId?: string } => (bootId() ? { bootId: bootId() } : {});

const processSchema = z.object({
  pid: z.number().int().positive(),
  /** Pins the pid against reuse. */
  startTime: z.number().int().nonnegative(),
  description: advisory(200),
  /** uuid-named, so only findable from here. */
  log: identifier(1024),
});

const stateSchema = z.object({
  /** `startTime` counts from boot, so it only pins a pid within one boot. An
   *  unusable stamp degrades to "no stamp", never to a rejected file. */
  bootId: z.string().max(64).optional().catch(undefined),
  processes: z.array(processSchema),
});

export type BackgroundProcess = z.infer<typeof processSchema>;

/** What `platform-bg` posts; the runtime pins `startTime` itself. */
export const declareProcessSchema = processSchema.omit({ startTime: true });

/** One piece of in-flight work, whichever way the platform learned of it. */
export interface BackgroundWorkEntry extends BackgroundWorkItem {
  /** Set when a harness session reported it. */
  sessionId?: string;
  /** Set when an agent declared the process — its liveness is the process. */
  pid?: number;
  log?: string;
}

export interface BackgroundWorkRegistry {
  /** A session's complete in-flight set; empty releases its hold. */
  report(sessionId: string, items: BackgroundWorkItem[]): void;
  /** False if the pid isn't running. */
  declare(entry: z.infer<typeof declareProcessSchema>): boolean;
  /** Is this session holding? Consulted before closing an idle session. */
  hasWork(sessionId: string): boolean;
  /** Reported holds only: a declared process is out of a recycle's reach. */
  reportedHolds(): number;
  /** Everything still running — drives the idle flag and the status surface. */
  held(): BackgroundWorkEntry[];
  /** Declared pids, which the reaper must leave alone. */
  spared(): Set<number>;
  /** Session is gone: whatever it supervised went with its subprocess. */
  forget(sessionId: string): void;
  /** Harness recycled or exited: same, for every session it served. */
  clear(): void;
  /** A released hold is a boundary too, so waiters can re-check. */
  onRelease(cb: () => void): void;
}

export function createBackgroundWorkRegistry(deps: {
  stateBackend: DocumentStoreBackend;
  log?: (msg: string) => void;
}): BackgroundWorkRegistry {
  const { log } = deps;

  /** Session → the set it last reported. */
  const holds = new Map<string, BackgroundWorkItem[]>();

  // Persisted: on the VM backend the runtime restarts without the pod.
  const store = deps.stateBackend.open("background-work", {
    schema: stateSchema,
    initial: () => ({ processes: [] }),
  });

  const releaseListeners: (() => void)[] = [];
  function notifyRelease(): void {
    for (const cb of releaseListeners) cb();
  }

  function describe(items: BackgroundWorkItem[]): string {
    return items
      .map((i) => i.description ?? i.command ?? i.id)
      .join(", ")
      .slice(0, 300);
  }

  /** Prunes what has finished, so liveness needs no retraction. Declarations
   *  from an earlier boot name processes that are gone whatever their pid says. */
  function liveProcesses(): BackgroundProcess[] {
    const state = store.read();
    if (
      bootId() !== "" &&
      state.bootId !== undefined &&
      state.bootId !== bootId()
    ) {
      if (state.processes.length > 0)
        log?.(
          `dropping ${state.processes.length} declaration(s) from a previous boot`,
        );
      store.write({ ...stamp(), processes: [] });
      return [];
    }
    const { processes } = state;
    const kept = processes.filter(
      (p) => readProcessEntry(p.pid)?.startTime === p.startTime,
    );
    if (kept.length !== processes.length) {
      for (const gone of processes.filter((p) => !kept.includes(p)))
        log?.(`declared process ${gone.pid} has finished`);
      store.write({ ...stamp(), processes: kept });
    }
    return kept;
  }

  return {
    report(sessionId, items) {
      const held = holds.has(sessionId);
      if (!items.length) {
        if (held) {
          holds.delete(sessionId);
          log?.(`background work in session ${sessionId} is done`);
          notifyRelease();
        }
        return;
      }
      holds.set(sessionId, items);
      if (!held)
        log?.(
          `holding session ${sessionId} for background work: ${describe(items)}`,
        );
    },

    declare(entry) {
      const running = readProcessEntry(entry.pid);
      if (!running) return false;
      const processes = liveProcesses().filter((p) => p.pid !== entry.pid);
      processes.push({ ...entry, startTime: running.startTime });
      store.write({ ...stamp(), processes });
      log?.(
        `declared process ${entry.pid}` +
          (entry.description ? ` — ${entry.description}` : ""),
      );
      return true;
    },

    hasWork(sessionId) {
      return holds.has(sessionId);
    },

    reportedHolds() {
      return holds.size;
    },

    held() {
      return [
        ...[...holds].flatMap(([sessionId, items]) =>
          items.map((item) => ({ ...item, sessionId })),
        ),
        ...liveProcesses().map((p) => ({
          id: `pid:${p.pid}`,
          pid: p.pid,
          ...(p.description !== undefined && { description: p.description }),
          ...(p.log !== undefined && { log: p.log }),
        })),
      ];
    },

    spared() {
      return new Set(liveProcesses().map((p) => p.pid));
    },

    // Neither drops a declared process: it is pod-scoped and outlives sessions.
    forget(sessionId) {
      if (holds.delete(sessionId)) notifyRelease();
    },

    clear() {
      if (holds.size === 0) return;
      holds.clear();
      notifyRelease();
    },

    onRelease(cb) {
      releaseListeners.push(cb);
    },
  };
}
