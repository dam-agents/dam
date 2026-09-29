import { createTRPCClient, httpBatchLink } from "@trpc/client";
import {
  delegationFramesSchema,
  sessionHistorySchema,
  type AppRouter,
} from "agent-runtime-api";
import { z } from "zod";

import { podBaseUrl } from "../../agents/infrastructure/k8s.js";
import type { DelegationFramesPort } from "../services/delegation-frames.js";

const CALL_TIMEOUT_MS = 15_000;

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

function clientFor(agentId: string, namespace: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${podBaseUrl(agentId, namespace)}/api/trpc`,
      }),
    ],
  });
}

async function logged<T>(
  what: string,
  agentId: string,
  fallback: T,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  try {
    return await call(AbortSignal.timeout(CALL_TIMEOUT_MS));
  } catch (err) {
    process.stderr.write(
      `[invocations] ${what} ${agentId} failed: ${err instanceof Error ? err.message : err}\n`,
    );
    return fallback;
  }
}

export function createPodSessionClient(opts: {
  namespace: string;
  isReady: (agentId: string) => Promise<boolean>;
}): DelegationFramesPort {
  return {
    readFromTarget: (targetId) =>
      logged("frames read", targetId, null, async (signal) => {
        const client = clientFor(targetId, opts.namespace);
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
      return logged("frames store on", rootId, null, async (signal) =>
        storedSchema.parse(
          await clientFor(
            rootId,
            opts.namespace,
          ).sessions.storeDelegationFrames.mutate(
            { invocationId, frames },
            { signal },
          ),
        ),
      );
    },

    readFromRoot: (rootId, invocationId) =>
      logged("frames read from", rootId, null, async (signal) => {
        const stored = delegationFramesSchema
          .nullable()
          .parse(
            await clientFor(
              rootId,
              opts.namespace,
            ).sessions.delegationFrames.query({ invocationId }, { signal }),
          );
        return stored?.frames ?? null;
      }),
  };
}
