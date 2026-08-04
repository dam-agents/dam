import { z } from "zod";
import type { SessionBackgroundWork } from "api-server-api";
import { podBaseUrl } from "./k8s.js";

// `.catch([])` folds a missing field (older pod image) into "nothing held".
const statusSchema = z.object({
  backgroundWork: z
    .array(
      z.object({
        sessionId: z.string(),
        items: z.array(
          z.object({
            id: z.string(),
            description: z.string().optional(),
            command: z.string().optional(),
          }),
        ),
      }),
    )
    .catch([]),
});

// The pod answers from memory; this read never waits for a wake.
const STATUS_TIMEOUT_MS = 3_000;

export interface PodStatusClient {
  backgroundWork(agentId: string): Promise<SessionBackgroundWork[]>;
}

/** Reads a pod's `/api/status` directly — never pokes activity or waits on
 *  readiness, so polling can't wake a hibernated agent or keep one warm. */
export function createPodStatusClient(namespace: string): PodStatusClient {
  return {
    async backgroundWork(agentId) {
      const res = await fetch(
        `http://${podBaseUrl(agentId, namespace)}/api/status`,
        { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
      );
      if (!res.ok) throw new Error(`pod status returned ${res.status}`);
      return statusSchema.parse(await res.json()).backgroundWork;
    },
  };
}
