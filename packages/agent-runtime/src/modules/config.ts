import { z } from "zod/v4";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  PLATFORM_DEV: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  IMAGE_WORKSPACE_DIR: z.string().default("/app/working-dir"),
  SKILL_MANIFEST_FILE: z
    .string()
    .default("/usr/local/share/dam-skill-manifest.json"),
  PLATFORM_IMAGE_SKILL_RECONCILE: z
    .string()
    .default("on")
    .transform((v) => v !== "off"),
  API_SERVER_URL: z.string().default(""),
  BACKGROUND_WORK_HOLDS: z
    .string()
    .default("on")
    .transform((v) => v !== "off"),
  QUEUE_PARK_MS: z.coerce.number().int().positive().optional(),
  MEM_REAPER: z
    .string()
    .default("on")
    .transform((v) => v !== "off"),
  MEM_REAPER_THRESHOLD: z.coerce.number().gt(0).lt(1).default(0.93),
});

export const config = schema.parse(process.env);
