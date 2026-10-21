import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";

import { loadYamlDocument } from "../../../core/yaml-document.js";

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
      const result = await fn(msg.input);
      parentPort.postMessage({ id: msg.id, result });
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

export interface StartedWorker {
  worker: Worker;
  ready: Promise<boolean>;
}

export const DEFAULT_EXPORT_NAME = "loadHistory";

const prestarted = new Map<string, StartedWorker>();

const workerKey = (modulePath: string, exportName: string): string =>
  `${modulePath}#${exportName}`;

export function startWorker(
  modulePath: string,
  exportName: string,
  log: (msg: string) => void,
  label = "history provider",
): StartedWorker {
  const worker = new Worker(WORKER_BOOTSTRAP, {
    eval: true,
    workerData: {
      moduleUrl: modulePath.startsWith("data:")
        ? modulePath
        : new URL(`file://${modulePath}`).href,
      exportName,
    },
  });
  worker.unref();
  const ready = new Promise<boolean>((resolve) => {
    const onFirst = (msg: { ready?: boolean; fatal?: string }): void => {
      if (msg.ready === true) {
        resolve(true);
        return;
      }
      if (msg.fatal !== undefined) {
        log(`${label} module failed to load: ${msg.fatal}`);
        resolve(false);
        return;
      }
    };
    worker.once("message", onFirst);
    worker.once("error", (error) => {
      log(
        `${label} worker error: ${error instanceof Error ? error.message : String(error)}`,
      );
      resolve(false);
    });
  });
  return { worker, ready };
}

export function takePrestartedWorker(
  modulePath: string,
  exportName: string,
): StartedWorker | undefined {
  const key = workerKey(modulePath, exportName);
  const started = prestarted.get(key);
  prestarted.delete(key);
  return started;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Starts the worker of every session-history module
 * the given runtime manifests declare, before the server bundle loads. On a vm
 * machine the module's import takes most of a second of file reads, and a
 * worker started only once the server listens is still importing when the
 * first session load after a wake asks for it. The worker provider of the same
 * module and export takes the started worker over. A manifest that does not
 * parse here starts nothing: the server reads every manifest again and
 * reports it.
 */
export function prestartHistoryWorkers(
  manifestPaths: readonly string[],
  log: (msg: string) => void,
): void {
  for (const path of manifestPaths) {
    let declared: { module?: unknown; exportName?: unknown } | undefined;
    try {
      declared = (
        loadYamlDocument(readFileSync(path, "utf8")) as {
          sessionHistory?: typeof declared;
        } | null
      )?.sessionHistory;
    } catch {
      continue;
    }
    if (typeof declared?.module !== "string") continue;
    const exportName =
      typeof declared.exportName === "string"
        ? declared.exportName
        : DEFAULT_EXPORT_NAME;
    const key = workerKey(declared.module, exportName);
    if (!prestarted.has(key)) {
      prestarted.set(key, startWorker(declared.module, exportName, log));
    }
  }
}
