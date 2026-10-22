export { composeModelRouter } from "./compose.js";
export {
  isAuxiliaryCall,
  isSideCall,
  SESSION_HEADER,
  sessionOf,
  sessionOfRunningTurn,
  subagentSessionOf,
  type SessionHandle,
} from "./domain/session-of.js";
export {
  applyReplayRules,
  dropUnsupportedReasoning,
  ensureStreamUsage,
  fitOutputBudget,
  floorOutputBudget,
} from "./domain/replay.js";
export { CODEX_CATALOG_PATH } from "./services/catalog-endpoints.js";
export {
  createModelRouter,
  type SessionModelChoice,
  HARNESS_HEADER,
  MODEL_ROUTER_DEFAULT_PORT,
  type ModelCallRecord,
  type ModelRouter,
  type ModelRouterDeps,
  type RouterExtension,
} from "./services/model-router.js";
export { resolveTarget } from "./domain/resolve-target.js";
export {
  processClassifierName,
  routerEnvFor,
  servedModels,
} from "./domain/harness-env.js";
export {
  classifierModelOnSessionProvider,
  tierModelOnSessionProvider,
  tierModels,
} from "./domain/tier-slots.js";
export { classify, normalizePath } from "./domain/classify.js";
export { upstreamWireOf, upstreamUrl } from "./domain/upstream.js";
export {
  createUsageScanner,
  traceOf,
  usageOfBody,
  type ModelUsage,
  type UncountedReason,
} from "./domain/usage.js";
export {
  createModelCallExporter,
  otlpLogRecord,
  otlpLogsPayload,
  otlpTargetOf,
  MODEL_CALL_BODY,
  type ModelCallExporter,
  type OtlpTarget,
} from "./infrastructure/call-exporter.js";
export { createSseModelRewrite, rewriteBody } from "./domain/model-rewrite.js";
