import type { HarnessClient } from "./harness-client.js";
import type { AgentRequestObserver } from "../acp/index.js";

const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 2_000;
const TOOL_NAME_MAX = 4096;

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
): { outcome: string; optionId?: string } | null {
  const outcome = (result as { outcome?: unknown } | null)?.outcome as
    { outcome?: unknown; optionId?: unknown } | undefined;
  if (typeof outcome?.outcome !== "string") return null;
  return {
    outcome: outcome.outcome,
    ...(typeof outcome.optionId === "string" && {
      optionId: outcome.optionId,
    }),
  };
}

function bounded(sent: Promise<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("report timed out")),
      ATTEMPT_TIMEOUT_MS,
    );
    sent.then(
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
 * record settles on.
 * Each attempt is bounded, and one request's reports wait only on that
 * request, so a stalled call cannot hold another request's decision window.
 * A request's own reports stay in order, so its end never overtakes it.
 */
export function createToolApprovalReporter(opts: {
  client: HarnessClient;
  log: (msg: string) => void;
}): AgentRequestObserver {
  const chains = new Map<string, Promise<void>>();
  const approvable = new Set<string>();
  const key = (id: unknown, sessionId: string) =>
    JSON.stringify([sessionId, id]);

  async function attempt(what: string, send: () => Promise<unknown>) {
    for (let n = 1; n <= ATTEMPTS; n++) {
      try {
        await bounded(send());
        return;
      } catch (err) {
        if (n === ATTEMPTS) {
          const reason = err instanceof Error ? err.message : String(err);
          opts.log(`giving up on ${what}: ${reason}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  function enqueue(
    key: string,
    what: string,
    send: () => Promise<unknown>,
  ): void {
    const chain = (chains.get(key) ?? Promise.resolve()).then(() =>
      attempt(what, send),
    );
    chains.set(key, chain);
    void chain.then(() => {
      if (chains.get(key) === chain) chains.delete(key);
    });
  }

  return {
    held(id, sessionId, line) {
      if (permissionRequestIn(line)) approvable.add(key(id, sessionId));
    },

    waiting(id, sessionId, line) {
      const frame = permissionRequestIn(line);
      if (!frame) return;
      approvable.add(key(id, sessionId));
      const toolCall = frame.params?.toolCall ?? {};
      const rawOptions: unknown = frame.params?.options;
      const options = (Array.isArray(rawOptions) ? rawOptions : []).filter(
        (o): o is { optionId: string; kind?: unknown } =>
          typeof (o as { optionId?: unknown } | null)?.optionId === "string",
      );
      enqueue(key(id, sessionId), `approval ${String(id)}`, () =>
        opts.client.approvals.v1.waiting.mutate({
          sessionId,
          rpcId: id,
          toolName:
            typeof toolCall.title === "string" && toolCall.title !== ""
              ? toolCall.title.slice(0, TOOL_NAME_MAX)
              : "tool call",
          ...(typeof toolCall.toolCallId === "string" && {
            toolCallId: toolCall.toolCallId,
          }),
          args: toolCall.rawInput,
          options: options.map((o) => ({
            optionId: o.optionId,
            kind: o.kind as never,
          })),
        }),
      );
    },

    answered(id, sessionId, result) {
      if (!approvable.delete(key(id, sessionId))) return;
      const outcome = outcomeOf(result);
      enqueue(key(id, sessionId), `approval ${String(id)} answer`, () =>
        opts.client.approvals.v1.ended.mutate({
          sessionId,
          rpcId: id,
          ...(outcome && { outcome }),
        }),
      );
    },

    abandoned(id, sessionId) {
      if (!approvable.delete(key(id, sessionId))) return;
      enqueue(key(id, sessionId), `approval ${String(id)} end`, () =>
        opts.client.approvals.v1.ended.mutate({ sessionId, rpcId: id }),
      );
    },
  };
}
