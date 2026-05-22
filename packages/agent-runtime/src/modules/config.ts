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
  /** Base URL for the harness API server, already shaped per-agent:
   *  `http://<harness-svc>/api/agents/<agent-id>`. Set by the controller
   *  at pod-spec time. When unset the runtime channel boot-loop is
   *  skipped — used in dev runs and for fork pods. ADR-048. */
  PLATFORM_RUNTIME_CHANNEL_URL: z.string().optional(),
  /** Build-time agent-runtime image version, reported in `hello`.
   *  Defaults to the running package's version baked at build time;
   *  override for tests. */
  PLATFORM_RUNTIME_VERSION: z.string().default("0.0.0"),
});

export const config = schema.parse(process.env);
