export {
  composeAttentionRetention,
  composeAttentionService,
  createAttentionCleanupHook,
  listAttentionAgentIds,
} from "./compose.js";
export { ATTENTION_RETENTION_DAYS } from "./domain/types.js";
export type { AttentionRepository } from "./infrastructure/attention-repository.js";
