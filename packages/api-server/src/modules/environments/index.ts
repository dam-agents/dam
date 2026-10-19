export { composeEnvironments } from "./compose.js";
export type { EnvironmentsComposition } from "./compose.js";
export { registerEnvironmentTools } from "./mcp-tools.js";
export type {
  EnvironmentsServiceImpl,
  OwningAgentEnvironments,
} from "./services/environments-service.js";
export {
  createEnvironmentGate,
  noEnvironmentGate,
  type EnvironmentGate,
} from "./gate/environment-gate.js";
export { composeEnvironmentGate, environmentNameLookup } from "./compose.js";
