import { z } from "zod/v4";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  PLATFORM_DEV: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  IMAGE_WORKSPACE_DIR: z.string().default("/app/working-dir"),
  API_SERVER_URL: z.string().default(""),
  BACKGROUND_WORK_HOLDS: z
    .string()
    .default("on")
    .transform((v) => v !== "off"),
  QUEUE_PARK_MS: z.coerce.number().int().positive().optional(),
});

export const config = schema.parse(process.env);
