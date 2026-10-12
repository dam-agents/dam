import { z } from "zod";
import type { AgentBackgroundWork } from "api-server-api";
import { podBaseUrl } from "./k8s.js";

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
  keptProcesses: z.number().int().nonnegative().catch(0),
});

const STATUS_TIMEOUT_MS = 3_000;

export interface PodStatusClient {
  backgroundWork(agentId: string): Promise<AgentBackgroundWork>;
}

export function createPodStatusClient(namespace: string): PodStatusClient {
  return {
    async backgroundWork(agentId) {
      const res = await fetch(
        `http://${podBaseUrl(agentId, namespace)}/api/status`,
        { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
      );
      if (!res.ok) throw new Error(`pod status returned ${res.status}`);
      const status = statusSchema.parse(await res.json());
      return {
        sessions: status.backgroundWork,
        keptProcesses: status.keptProcesses,
      };
    },
  };
}
