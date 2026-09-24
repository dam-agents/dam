import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";

import { podBaseUrl } from "../../agents/infrastructure/k8s.js";
import type {
  TargetFrames,
  TargetFramesReader,
} from "../services/target-frames-reader.js";

const READ_TIMEOUT_MS = 15_000;

export function invocationScheduleId(agentId: string): string {
  return `invocation:${agentId}`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a target runs exactly one session, the trigger
 * session the spawn opened, which carries the invocation's schedule id. Picking
 * it by that id rather than by position keeps a target that somehow holds more
 * than one session from handing back the wrong conversation; the newest wins.
 */
function pickInvocationSession(
  sessions: readonly {
    sessionId: string;
    scheduleId: string | null;
    createdAt: string;
  }[],
  agentId: string,
): string | null {
  const wanted = invocationScheduleId(agentId);
  const mine = sessions
    .filter((s) => s.scheduleId === wanted)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return mine.at(-1)?.sessionId ?? null;
}

export function createPodSessionClient(namespace: string): TargetFramesReader {
  return {
    async read(agentId): Promise<TargetFrames | null> {
      const signal = AbortSignal.timeout(READ_TIMEOUT_MS);
      const client = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
          }),
        ],
      });
      try {
        const { sessions } = await client.sessions.list.query(undefined, {
          signal,
        });
        const sessionId = pickInvocationSession(sessions, agentId);
        if (sessionId === null) return null;
        return await client.sessions.history.query({ sessionId }, { signal });
      } catch (err) {
        process.stderr.write(
          `[invocations] frames read ${agentId} failed: ${err instanceof Error ? err.message : err}\n`,
        );
        return null;
      }
    },
  };
}
