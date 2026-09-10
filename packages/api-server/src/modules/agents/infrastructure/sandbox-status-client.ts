import { z } from "zod";
import type { SessionBackgroundWork } from "api-server-api";
import type { SandboxAddresses } from "./sandbox-addresses.js";

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

const STATUS_TIMEOUT_MS = 3_000;

export interface SandboxStatusClient {
  backgroundWork(agentId: string): Promise<SessionBackgroundWork[]>;
}

export function createSandboxStatusClient(
  addresses: SandboxAddresses,
): SandboxStatusClient {
  return {
    async backgroundWork(agentId) {
      const res = await fetch(
        `http://${addresses.baseUrl(agentId)}/api/status`,
        { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
      );
      if (!res.ok) throw new Error(`sandbox status returned ${res.status}`);
      return statusSchema.parse(await res.json()).backgroundWork;
    },
  };
}
