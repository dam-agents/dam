import { z } from "zod/v4";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  PLATFORM_DEV: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  HOME_DIR: z.string().default("/home/agent"),
  WORK_DIR: z.string().default("/home/agent/work"),
  API_SERVER_URL: z.string().default(""),
});

export const config = schema.parse(process.env);
