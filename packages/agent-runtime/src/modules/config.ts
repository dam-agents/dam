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
  // Background-work holds (#2965). Unset keeps the tracker's defaults: a hold
  // lasts as long as the work does, and a couple of sessions may hold at once.
  // Present so an install can bound a hold, or turn the tracking off, without a
  // new image.
  BACKGROUND_WORK_HOLD_MAX_MINUTES: z.coerce.number().optional(),
  BACKGROUND_WORK_MAX_HELD_SESSIONS: z.coerce.number().optional(),
});

export const config = schema.parse(process.env);
