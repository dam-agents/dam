import { z } from "zod/v4";

// Forgiving boolean: these flags can be hand-set in an image Dockerfile, so
// accept the common truthy spellings rather than only the exact "true".
const boolEnv = (v: string): boolean =>
  ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  PLATFORM_DEV: z.string().default("false").transform(boolEnv),
  HOME_DIR: z.string().default("/home/agent"),
  WORK_DIR: z.string().default("/home/agent/work"),
  API_SERVER_URL: z.string().default(""),
});

export const config = schema.parse(process.env);
