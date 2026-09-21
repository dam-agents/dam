export {
  composeAttentionRetention,
  composeAttentionService,
  createAttentionCleanupHook,
  composeSessionWatcher,
  listAttentionAgentIds,
} from "./compose.js";
export { ATTENTION_RETENTION_DAYS } from "./domain/types.js";
export type { AttentionRepository } from "./infrastructure/attention-repository.js";
export type { SessionWatcher } from "./services/session-watcher.js";
