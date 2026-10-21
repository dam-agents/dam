export { composeChanges } from "./compose.js";
export type { ChangesRuntime } from "./services/changes-service.js";
export {
  createToolActivityReader,
  type ToolActivity,
} from "./domain/tool-activity.js";
export { gitTraceEnv } from "./domain/git-trace.js";
export { createGitTraceReader } from "./infrastructure/git-traces.js";
