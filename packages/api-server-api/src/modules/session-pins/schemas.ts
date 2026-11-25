import { z } from "zod";

const idSchema = z.string().trim().min(1).max(256);

export const sessionPinKeySchema = z.object({
  agentId: idSchema,
  sessionId: idSchema,
});
