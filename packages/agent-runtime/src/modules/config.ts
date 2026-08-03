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
  // Background-work holds (#2965). "off" refuses every hold, so an install that
  // finds the behaviour surprising can turn it off without a new image.
  BACKGROUND_WORK_HOLDS: z
    .string()
    .default("on")
    .transform((v) => v !== "off"),
});

export const config = schema.parse(process.env);
