export {
  composeSatellitesModule,
  type SatellitesComposition,
} from "./compose.js";
export {
  DEFAULT_SATELLITE_WAIT_MS,
  registerSatelliteTools,
} from "./mcp-tools.js";
export type { SatelliteAgentOpsImpl } from "./services/agent-ops.js";
export {
  createOutcomeDelivery,
  createOutcomeWakeRetry,
} from "./services/outcome-delivery.js";
export { createSatelliteFileRoutes } from "./routes/file-transfer.js";
export { createAgentFileChannelRoutes } from "./routes/agent-file-channel.js";
export { FILE_OP_DEADLINE_MS } from "./services/file-channel.js";
export { createAgentTransfer } from "./infrastructure/agent-transfer.js";
