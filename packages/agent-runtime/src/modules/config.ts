import { z } from "zod/v4";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  PLATFORM_DEV: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  HOME_DIR: z.string().default("/home/agent"),
  WORK_DIR: z.string().default("/home/agent/work"),
  TRIGGERS_DIR: z.string().default("/home/agent/.triggers"),
  API_SERVER_URL: z.string().default(""),
  PLATFORM_MCP_URL: z.string().optional(),
  /** SSE endpoint for declarative pod-files materialization (built by the
   *  reconciler from the harness server URL + agent id). When unset the
   *  loop is skipped — used for forks and any pod that shouldn't receive
   *  pod-files state. */
  PLATFORM_POD_FILES_EVENTS_URL: z.string().optional(),
});

export const config = schema.parse(process.env);
