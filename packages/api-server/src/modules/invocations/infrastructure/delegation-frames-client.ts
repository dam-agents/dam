import {
  delegationFramesSchema,
  sessionHistorySchema,
} from "agent-runtime-api";
import { z } from "zod";

import { agentServiceClient } from "../../../core/agent-service-client.js";
import { invocationScheduleId } from "../domain/target-name.js";
import type { DelegationFramesPort } from "../services/delegation-frames.js";

const sessionListSchema = z.object({
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      scheduleId: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

const storedSchema = z.object({ truncated: z.boolean() });

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

// UNIT_BOUNDARY_DESCRIPTION: a frames read is two calls, and they share one budget so a slow target cannot eat the whole capture window before the frames are stored.
const READ_TIMEOUT_MS = 15_000;

async function logged<T>(
  what: string,
  agentId: string,
  fallback: T,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  try {
    return await call(AbortSignal.timeout(READ_TIMEOUT_MS));
  } catch (err) {
    process.stderr.write(
      `[invocations] ${what} ${agentId} failed: ${err instanceof Error ? err.message : err}\n`,
    );
    return fallback;
  }
}

export function createDelegationFramesClient(opts: {
  namespace: string;
  isReady: (agentId: string) => Promise<boolean>;
}): DelegationFramesPort {
  return {
    readFromTarget: (targetId) =>
      logged("frames read", targetId, null, async (signal) => {
        const client = agentServiceClient(targetId, opts.namespace);
        const { sessions } = sessionListSchema.parse(
          await client.sessions.list.query(undefined, { signal }),
        );
        const sessionId = pickInvocationSession(sessions, targetId);
        if (sessionId === null) return null;
        return sessionHistorySchema.parse(
          await client.sessions.history.query({ sessionId }, { signal }),
        );
      }),

    async storeOnRoot(rootId, invocationId, frames) {
      if (!(await opts.isReady(rootId))) return null;
      return logged("frames store on", rootId, null, async () =>
        storedSchema.parse(
          await agentServiceClient(
            rootId,
            opts.namespace,
          ).sessions.storeDelegationFrames.mutate({ invocationId, frames }),
        ),
      );
    },

    readFromRoot: (rootId, invocationId) =>
      logged("frames read from", rootId, null, async () => {
        const stored = delegationFramesSchema
          .nullable()
          .parse(
            await agentServiceClient(
              rootId,
              opts.namespace,
            ).sessions.delegationFrames.query({ invocationId }),
          );
        return stored?.frames ?? null;
      }),
  };
}
