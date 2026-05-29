import { setScriptInputSchema } from "mock-agent-api";
import { z } from "zod";

export const e2eAgentIdInputSchema = z
  .object({ agentId: z.string().min(1) })
  .strict();

export const e2eSetScriptInputSchema = z
  .object({
    agentId: z.string().min(1),
    script: setScriptInputSchema,
  })
  .strict();
