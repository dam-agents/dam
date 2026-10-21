import {
  startWorker,
  takePrestartedWorker,
  type StartedWorker,
} from "./history-worker.js";

export type WorkerCallOutcome =
  { ok: true; result: unknown } | { ok: false; error: string };

export interface WorkerCall {
  call(
    input: unknown,
    timeoutMs: number,
    opts?: { stopOnTimeout?: boolean },
  ): Promise<WorkerCallOutcome>;
  warm(): void;
}

interface WorkerHandle extends StartedWorker {
  inFlight: Map<number, (outcome: WorkerCallOutcome) => void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Hosts one image-declared module export in one
 * persistent worker thread and calls it with one input at a time per request
 * id. The worker is the one the runtime's entry point started for this module
 * and export, or else spawned on first use. Every failure — spawn, import, the
 * export throwing, a crash, a timeout — settles that call as not ok with its
 * reason; a dead worker is respawned on the next call. A timeout settles the
 * call only, and the export may still be running in the worker, unless the
 * caller asks to stop the worker on a timeout.
 */
export function createWorkerCall(deps: {
  modulePath: string;
  exportName: string;
  label: string;
  log: (msg: string) => void;
}): WorkerCall {
  let handle: WorkerHandle | null = null;
  let nextId = 1;

  function ensureWorker(): WorkerHandle {
    if (handle) return handle;
    const started =
      takePrestartedWorker(deps.modulePath, deps.exportName) ??
      startWorker(deps.modulePath, deps.exportName, deps.log, deps.label);
    const inFlight = new Map<number, (outcome: WorkerCallOutcome) => void>();
    const created: WorkerHandle = { ...started, inFlight };
    started.worker.on(
      "message",
      (msg: { id?: number; result?: unknown; error?: string }) => {
        if (typeof msg.id !== "number") return;
        const settle = inFlight.get(msg.id);
        if (!settle) return;
        inFlight.delete(msg.id);
        settle(
          msg.error !== undefined
            ? { ok: false, error: msg.error }
            : { ok: true, result: msg.result },
        );
      },
    );
    const dropWorker = (): void => {
      if (handle === created) handle = null;
      for (const settle of inFlight.values()) {
        settle({ ok: false, error: "the worker stopped" });
      }
      inFlight.clear();
    };
    started.worker.on("error", dropWorker);
    started.worker.on("exit", dropWorker);
    handle = created;
    return created;
  }

  return {
    warm: () => void ensureWorker(),
    async call(input, timeoutMs, opts) {
      const current = ensureWorker();
      if (!(await current.ready)) {
        if (handle === current) handle = null;
        void current.worker.terminate();
        return { ok: false, error: "the module did not load" };
      }
      const id = nextId++;
      return new Promise<WorkerCallOutcome>((resolve) => {
        const timer = setTimeout(() => {
          current.inFlight.delete(id);
          const stopped = opts?.stopOnTimeout === true;
          if (stopped) {
            if (handle === current) handle = null;
            void current.worker.terminate();
          }
          resolve({
            ok: false,
            error: `timed out after ${timeoutMs}ms${stopped ? "; the worker was stopped" : ""}`,
          });
        }, timeoutMs);
        current.inFlight.set(id, (outcome) => {
          clearTimeout(timer);
          resolve(outcome);
        });
        current.worker.postMessage({ id, input });
      });
    },
  };
}
