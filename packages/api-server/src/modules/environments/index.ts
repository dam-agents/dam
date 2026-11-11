export { composeEnvironments } from "./compose.js";
export type { EnvironmentsComposition } from "./compose.js";
export { registerEnvironmentTools, parseIdleTimeout } from "./mcp-tools.js";
export type {
  AgentDirectory,
  EnvironmentsServiceImpl,
  OwningAgentEnvironments,
} from "./services/environments-service.js";
export {
  createEnvironmentGate,
  noEnvironmentGate,
  type EnvironmentGate,
} from "./gate/environment-gate.js";
export { composeEnvironmentGate, environmentNameLookup } from "./compose.js";
export { createEgressIdentityResolver } from "./services/egress-identity.js";
export { domainOf as environmentsDomainOf } from "./domain/gate.js";
export { portOf as environmentsPortOf } from "./domain/gate.js";
