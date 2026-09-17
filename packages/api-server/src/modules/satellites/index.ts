export {
  composeSatellitesModule,
  type SatellitesComposition,
} from "./compose.js";
export { registerSatelliteTools } from "./mcp-tools.js";
export type { SatelliteAgentOpsImpl } from "./services/agent-ops.js";
export {
  createOutcomeDelivery,
  createOutcomeWakeRetry,
} from "./services/outcome-delivery.js";
export { createSatelliteApprovalRequester } from "./infrastructure/approval-requests.js";
