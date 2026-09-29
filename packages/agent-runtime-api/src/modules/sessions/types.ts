import type { z } from "zod";
import type {
  podSessionNoticeSchema,
  podSessionModeSchema,
  podSessionSchema,
  podSessionTypeSchema,
  sessionHistoryInputSchema,
  sessionHistorySchema,
  sessionDirectoryEntrySchema,
  storeDelegationFramesInputSchema,
  delegationFramesSchema,
} from "./schemas.js";

export type PodSessionMode = z.infer<typeof podSessionModeSchema>;
export type PodSessionType = z.infer<typeof podSessionTypeSchema>;
export type PodSession = z.infer<typeof podSessionSchema>;
export type PodSessionNotice = z.infer<typeof podSessionNoticeSchema>;
export type SessionHistoryInput = z.infer<typeof sessionHistoryInputSchema>;
export type SessionHistory = z.infer<typeof sessionHistorySchema>;
export type StoreDelegationFramesInput = z.infer<
  typeof storeDelegationFramesInputSchema
>;
export type DelegationFrames = z.infer<typeof delegationFramesSchema>;

export interface SessionsService {
  list(): Promise<PodSession[]>;
  watch(signal?: AbortSignal): AsyncIterable<PodSessionNotice>;
  history(sessionId: string): Promise<SessionHistory>;
  storeDelegationFrames(
    input: StoreDelegationFramesInput,
  ): Promise<{ truncated: boolean }>;
  delegationFrames(invocationId: string): Promise<DelegationFrames | null>;
}

export type SessionDirectoryEntry = z.infer<typeof sessionDirectoryEntrySchema>;
