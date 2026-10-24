import { z } from "zod";
import type { AgentBackgroundWork } from "api-server-api";
import { agentServiceAddress } from "./k8s.js";

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
  openLinks: z.number().int().nonnegative().catch(0),
  idle: z.boolean().catch(false),
});

const STATUS_TIMEOUT_MS = 3_000;

export interface AgentServiceStatusClient {
  backgroundWork(agentId: string): Promise<AgentBackgroundWork>;
}

async function readStatus(
  agentId: string,
  namespace: string,
): Promise<z.infer<typeof statusSchema>> {
  const res = await fetch(
    `http://${agentServiceAddress(agentId, namespace)}/api/status`,
    { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`agent service status returned ${res.status}`);
  return statusSchema.parse(await res.json());
}

export async function agentServiceIsIdle(
  agentId: string,
  namespace: string,
): Promise<boolean> {
  return (await readStatus(agentId, namespace)).idle;
}

export function createAgentServiceStatusClient(
  namespace: string,
): AgentServiceStatusClient {
  return {
    async backgroundWork(agentId) {
      const status = await readStatus(agentId, namespace);
      return {
        sessions: status.backgroundWork,
        keptProcesses: status.keptProcesses,
        openLinks: status.openLinks,
      };
    },
  };
}
