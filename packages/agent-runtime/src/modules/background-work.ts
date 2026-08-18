import { readFileSync } from "node:fs";
import { z } from "zod";
import type { BackgroundWorkItem } from "agent-runtime-api";
import type { DocumentStoreBackend } from "../core/document-store.js";
import { readProcessEntry } from "../core/process-table.js";

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

const advisory = (max: number) =>
  z
    .string()
    .transform((text) => text.slice(0, max))
    .optional();

const identifier = (max: number) =>
  z
    .string()
    .transform((value) => (value.length > max ? undefined : value))
    .optional();

const stamp = (): { bootId?: string } => (bootId() ? { bootId: bootId() } : {});

const processSchema = z.object({
  pid: z.number().int().positive(),
  startTime: z.number().int().nonnegative(),
  description: advisory(200),
  log: identifier(1024),
});

const stateSchema = z.object({
  bootId: z.string().max(64).optional().catch(undefined),
  processes: z.array(processSchema),
});

export type BackgroundProcess = z.infer<typeof processSchema>;

export const declareProcessSchema = processSchema.omit({ startTime: true });

export interface BackgroundWorkEntry extends BackgroundWorkItem {
  sessionId?: string;
  pid?: number;
  log?: string;
}

export interface BackgroundWorkRegistry {
  report(sessionId: string, items: BackgroundWorkItem[]): void;
  declare(entry: z.infer<typeof declareProcessSchema>): boolean;
  hasWork(sessionId: string): boolean;
  reportedHolds(): number;
  held(): BackgroundWorkEntry[];
  spared(): Set<number>;
  forget(sessionId: string): void;
  clear(): void;
  onRelease(cb: () => void): void;
}

export function createBackgroundWorkRegistry(deps: {
  stateBackend: DocumentStoreBackend;
  log?: (msg: string) => void;
}): BackgroundWorkRegistry {
  const { log } = deps;

  const holds = new Map<string, BackgroundWorkItem[]>();

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
