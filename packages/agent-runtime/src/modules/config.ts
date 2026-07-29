import { z } from "zod/v4";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  PLATFORM_DEV: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  HOME_DIR: z.string().default("/home/agent"),
  WORK_DIR: z.string().default("/home/agent/work"),
  // Pristine workspace copy in the image (the first-boot seed source) —
  // the reference for skill origin classification.
  IMAGE_WORKSPACE_DIR: z.string().default("/app/working-dir"),
  API_SERVER_URL: z.string().default(""),
  // Background-work holds (#2965): how many sessions may hold their subprocess
  // open for reported work at once. Unset keeps the registry's small default;
  // `0` refuses every hold, which is the kill switch for the feature.
  BACKGROUND_WORK_MAX_HELD_SESSIONS: z.coerce.number().optional(),
});

export const config = schema.parse(process.env);
