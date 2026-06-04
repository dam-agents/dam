import type * as k8s from "@kubernetes/client-node";
import type { ForkStatus } from "../domain/fork.js";
import { err, ok, type Result } from "../../../core/result.js";
import type { ForkOrchestratorPort, OrchestratorCreateError } from "./ports.js";
import { buildForkObject, parseForkStatus } from "./fork-mappers.js";
import { FORKS_PLURAL, GROUP, VERSION } from "./labels.js";

export interface K8sForkOrchestratorDeps {
  customObjects: k8s.CustomObjectsApi;
  namespace: string;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createK8sForkOrchestrator(
  deps: K8sForkOrchestratorDeps,
): ForkOrchestratorPort {
  const pollIntervalMs = deps.pollIntervalMs ?? 1000;
  const sleep = deps.sleep ?? defaultSleep;

  return {
    async createFork({ forkId, spec }) {
      try {
        await deps.customObjects.createNamespacedCustomObject({
          group: GROUP,
          version: VERSION,
          namespace: deps.namespace,
          plural: FORKS_PLURAL,
          body: buildForkObject({ forkId, spec }),
        });
        return ok(undefined);
      } catch (cause) {
        if (isConflict(cause)) {
          return err<OrchestratorCreateError>({ kind: "AlreadyExists" });
        }
        return err<OrchestratorCreateError>({
          kind: "WriteFailed",
          detail: describeError(cause),
        });
      }
    },

    watchStatus(forkId) {
      return pollForkStatus({
        customObjects: deps.customObjects,
        namespace: deps.namespace,
        pollIntervalMs,
        sleep,
        forkId,
      });
    },

    async deleteFork(forkId) {
      try {
        await deps.customObjects.deleteNamespacedCustomObject({
          group: GROUP,
          version: VERSION,
          namespace: deps.namespace,
          plural: FORKS_PLURAL,
          name: forkId,
        });
      } catch (cause) {
        if (!isNotFound(cause)) throw cause;
      }
    },
  };
}

async function* pollForkStatus(args: {
  customObjects: k8s.CustomObjectsApi;
  namespace: string;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
  forkId: string;
}): AsyncIterable<ForkStatus> {
  let lastPhase: ForkStatus["phase"] | null = null;
  while (true) {
    let obj: unknown = null;
    try {
      obj = await args.customObjects.getNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace: args.namespace,
        plural: FORKS_PLURAL,
        name: args.forkId,
      });
    } catch (cause) {
      if (isNotFound(cause)) return;
    }
    if (obj) {
      const status = parseForkStatus(obj as { status?: unknown });
      if (status && status.phase !== lastPhase) {
        lastPhase = status.phase;
        yield status;
        if (
          status.phase === "Ready" ||
          status.phase === "Failed" ||
          status.phase === "Completed"
        ) {
          return;
        }
      }
    }
    await args.sleep(args.pollIntervalMs);
  }
}

function isNotFound(cause: unknown): boolean {
  return hasNumericCode(cause, 404);
}

function isConflict(cause: unknown): boolean {
  return hasNumericCode(cause, 409);
}

function hasNumericCode(cause: unknown, code: number): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code: unknown }).code === code
  );
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateForkId(prefix = "fork"): string {
  const random = Math.random().toString(16).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}-${ts}-${random}`;
}
