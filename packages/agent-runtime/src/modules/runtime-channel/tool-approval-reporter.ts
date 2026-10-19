import type { HarnessClient } from "./harness-client.js";
import type { AgentRequestObserver } from "../acp/index.js";

const ATTEMPTS = 3;
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: Tells the api-server about a tool approval that
 * no client can answer, as soon as that is so, and about how it ended. The
 * api-server records such a request only from the ACP relay, which sees it
 * only while a client engages the session, so without this report a request
 * in an unwatched session shows nowhere until it expires. Reports go out one
 * at a time, in order, so an end never overtakes the request it ends.
 */
export function createToolApprovalReporter(opts: {
  client: HarnessClient;
  log: (msg: string) => void;
}): AgentRequestObserver {
  let queue: Promise<void> = Promise.resolve();
  const reported = new Set<string>();
  const key = (id: unknown, sessionId: string) =>
    JSON.stringify([sessionId, id]);

  async function attempt(what: string, send: () => Promise<unknown>) {
    for (let n = 1; n <= ATTEMPTS; n++) {
      try {
        await send();
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

  function enqueue(what: string, send: () => Promise<unknown>): void {
    queue = queue.then(() => attempt(what, send));
  }

  return {
    waiting(id, sessionId, line) {
      const frame = permissionRequestIn(line);
      if (!frame) return;
      const toolCall = frame.params?.toolCall ?? {};
      reported.add(key(id, sessionId));
      const rawOptions: unknown = frame.params?.options;
      const options = (Array.isArray(rawOptions) ? rawOptions : []).filter(
        (o): o is { optionId: string; kind?: unknown } =>
          typeof (o as { optionId?: unknown } | null)?.optionId === "string",
      );
      enqueue(`approval ${String(id)}`, () =>
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
      if (!reported.delete(key(id, sessionId))) return;
      const outcome = outcomeOf(result);
      enqueue(`approval ${String(id)} answer`, () =>
        opts.client.approvals.v1.ended.mutate({
          sessionId,
          rpcId: id,
          ...(outcome && { outcome }),
        }),
      );
    },

    abandoned(id, sessionId) {
      if (!reported.delete(key(id, sessionId))) return;
      enqueue(`approval ${String(id)} end`, () =>
        opts.client.approvals.v1.ended.mutate({ sessionId, rpcId: id }),
      );
    },
  };
}
