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
});

export const config = schema.parse(process.env);
