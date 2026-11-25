import { z } from "zod";

export const SESSION_PINS_MAX = 200;

const idSchema = z.string().trim().min(1).max(256);

export const sessionPinKeySchema = z.object({
  agentId: idSchema,
  sessionId: idSchema,
});
