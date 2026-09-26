export { composeTelemetryReader } from "./compose.js";
export { createTelemetryRoutes } from "./routes.js";
export { attachLogsToSpans, type UnattachedLog } from "./domain/attach-logs.js";
export {
  createDisabledTelemetryService,
  createTelemetryService,
  ownedTelemetryScope,
  scopeOwnedAgentIds,
  type OwnedAgent,
  type TelemetryReader,
} from "./services/telemetry-service.js";
export {
  createClickhouseTelemetryReader,
  ownedLogs,
  ownedSpans,
  toIsoUtc,
} from "./infrastructure/clickhouse-telemetry-reader.js";
