import {
  permissionOptionKindsOf,
  recordedOptionsOf,
  recordedToolOf,
  TOOL_CALL_ID_MAX,
} from "api-server-api";
import type { AcpPermissionOptionKind } from "api-server-api";

import type { HarnessClient } from "./harness-client.js";
import type { AgentRequestObserver } from "../acp/index.js";

const END_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 2_000;
const RETRY_DELAY_MAX_MS = 30_000;
const OUTCOME_MAX = 64;

interface PermissionRequestFrame {
  method?: unknown;
  params?: {
    toolCall?: { toolCallId?: unknown; title?: unknown; rawInput?: unknown };
    options?: unknown;
  };
}

function permissionRequestIn(line: string): PermissionRequestFrame | null {
  try {
    const frame = JSON.parse(line) as PermissionRequestFrame | null;
    return frame?.method === "session/request_permission" ? frame : null;
  } catch {
    return null;
  }
}

function outcomeOf(
  result: unknown,
  kinds: ReadonlyMap<string, AcpPermissionOptionKind>,
): {
  outcome: string;
  optionId?: string;
  kind?: AcpPermissionOptionKind;
} | null {
  const outcome = (result as { outcome?: unknown } | null)?.outcome as
    { outcome?: unknown; optionId?: unknown } | undefined;
  if (typeof outcome?.outcome !== "string") return null;
  const chosen = typeof outcome.optionId === "string" ? outcome.optionId : "";
  const kind = kinds.get(chosen);
  const optionId = chosen.slice(0, TOOL_CALL_ID_MAX);
  return {
    outcome: outcome.outcome.slice(0, OUTCOME_MAX),
    ...(chosen !== "" && { optionId }),
    ...(kind !== undefined && { kind }),
  };
}

function bounded(send: (signal: AbortSignal) => Promise<unknown>) {
  const abort = new AbortController();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      abort.abort();
      reject(new Error("report timed out"));
    }, ATTEMPT_TIMEOUT_MS);
    send(abort.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Tells the api-server about a tool approval that
 * no client can answer, as soon as that is so, and about how it ended. The
 * api-server records such a request only from the ACP relay, which sees it
 * only while a client engages the session, so without this report a request
 * in an unwatched session shows nowhere until it expires. The end is reported
 * for every permission request the runtime held, watched or not: the runtime
 * accepts the answer the harness got, so its report is what the platform's
 * record settles on, and the option it accepted states the choice's kind even
 * where the recorded catalog dropped that option.
 * A waiting report is retried until the request ends: the api-server may be
 * restarting, and a request that stayed invisible for its whole window is the
 * defect this report exists to fix. End reports are retried briefly, since a
 * row left pending by a lost end is worse than a late one.
 * Each attempt is bounded and aborted at its deadline, and one request's
 * reports wait only on that request, so a stalled call cannot hold another
 * request's decision window.
 * The first attempt of a report always goes out, and its retries stop once
 * the request is over, so a request's reports stay in order and its end
 * never overtakes it.
 */
export function createToolApprovalReporter(opts: {
  client: HarnessClient;
  log: (msg: string) => void;
}): AgentRequestObserver {
  const chains = new Map<string, Promise<void>>();
  const approvable = new Map<string, Map<string, AcpPermissionOptionKind>>();
  const key = (id: unknown, sessionId: string) =>
    JSON.stringify([sessionId, id]);

  async function attempt(
    what: string,
    send: (signal: AbortSignal) => Promise<unknown>,
    stillWanted: () => boolean,
    attempts: number,
  ) {
    for (let n = 1; ; n++) {
      if (n > 1 && !stillWanted()) {
        opts.log(`dropping ${what}: the request is over`);
        return;
      }
      try {
        await bounded(send);
        return;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (n >= attempts || !stillWanted()) {
          opts.log(`giving up on ${what}: ${reason}`);
          return;
        }
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(RETRY_DELAY_MS * 2 ** (n - 1), RETRY_DELAY_MAX_MS),
          ),
        );
      }
    }
  }

  function enqueue(
    key: string,
    what: string,
    send: (signal: AbortSignal) => Promise<unknown>,
    stillWanted: () => boolean = () => true,
    attempts: number = END_ATTEMPTS,
  ): void {
    const chain = (chains.get(key) ?? Promise.resolve()).then(() =>
      attempt(what, send, stillWanted, attempts),
    );
    chains.set(key, chain);
    void chain.then(() => {
      if (chains.get(key) === chain) chains.delete(key);
    });
  }

  return {
    held(id, sessionId, line) {
      const frame = permissionRequestIn(line);
      if (!frame) return;
      approvable.set(
        key(id, sessionId),
        permissionOptionKindsOf(frame.params?.options),
      );
    },

    waiting(id, sessionId, line) {
      const frame = permissionRequestIn(line);
      if (!frame) return;
      const k = key(id, sessionId);
      approvable.set(k, permissionOptionKindsOf(frame.params?.options));
      const { toolName, toolCallId } = recordedToolOf(frame.params?.toolCall);
      enqueue(
        k,
        `approval ${String(id)}`,
        (signal) =>
          opts.client.approvals.v1.waiting.mutate(
            {
              sessionId,
              rpcId: id,
              toolName,
              ...(toolCallId !== undefined && { toolCallId }),
              args: frame.params?.toolCall?.rawInput,
              idsWhole: true,
              options: recordedOptionsOf(frame.params?.options),
            },
            { signal },
          ),
        () => approvable.has(k),
        Infinity,
      );
    },

    answered(id, sessionId, result) {
      const kinds = approvable.get(key(id, sessionId));
      if (kinds === undefined) return;
      approvable.delete(key(id, sessionId));
      const outcome = outcomeOf(result, kinds);
      enqueue(key(id, sessionId), `approval ${String(id)} answer`, (signal) =>
        opts.client.approvals.v1.ended.mutate(
          { sessionId, rpcId: id, ...(outcome && { outcome }) },
          { signal },
        ),
      );
    },

    abandoned(id, sessionId) {
      if (!approvable.delete(key(id, sessionId))) return;
      enqueue(key(id, sessionId), `approval ${String(id)} end`, (signal) =>
        opts.client.approvals.v1.ended.mutate(
          { sessionId, rpcId: id },
          { signal },
        ),
      );
    },
  };
}
