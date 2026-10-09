import type { z } from "zod";
import type {
  podSessionNoticeSchema,
  podSessionModeSchema,
  podSessionSchema,
  podSessionTypeSchema,
  sessionHistoryInputSchema,
  sessionHistorySchema,
  storeDelegationFramesInputSchema,
  delegationFramesSchema,
  sessionCategorySchema,
  sessionDirectoryEntrySchema,
  sessionListCursorSchema,
  sessionListInputSchema,
  sessionSpendInputSchema,
  sessionSpendSchema,
} from "./schemas.js";

export type PodSessionMode = z.infer<typeof podSessionModeSchema>;
export type PodSessionType = z.infer<typeof podSessionTypeSchema>;
export type PodSession = z.infer<typeof podSessionSchema>;
export type SessionSpend = z.infer<typeof sessionSpendSchema>;
export type SessionSpendInput = z.infer<typeof sessionSpendInputSchema>;

export interface SessionSpendTotal extends SessionSpend {
  sessions: number;
}

export type PodSessionNotice = z.infer<typeof podSessionNoticeSchema>;
export type SessionCategory = z.infer<typeof sessionCategorySchema>;
export type SessionListCursor = z.infer<typeof sessionListCursorSchema>;
export type SessionListQuery = NonNullable<
  z.infer<typeof sessionListInputSchema>
>;

export interface SessionPage {
  sessions: PodSession[];
  nextCursor: SessionListCursor | null;
}

export type SessionHistoryInput = z.infer<typeof sessionHistoryInputSchema>;
export type SessionHistory = z.infer<typeof sessionHistorySchema>;
export type StoreDelegationFramesInput = z.infer<
  typeof storeDelegationFramesInputSchema
>;
export type DelegationFrames = z.infer<typeof delegationFramesSchema>;

export interface SessionsService {
  list(query?: SessionListQuery): Promise<SessionPage>;
  watch(signal?: AbortSignal): AsyncIterable<PodSessionNotice>;
  history(sessionId: string): Promise<SessionHistory>;
  storeDelegationFrames(
    input: StoreDelegationFramesInput,
  ): Promise<{ truncated: boolean }>;
  delegationFrames(invocationId: string): Promise<DelegationFrames | null>;
  spend(input: SessionSpendInput): Promise<SessionSpendTotal | null>;
}

export type SessionDirectoryEntry = z.infer<typeof sessionDirectoryEntrySchema>;

export const PIN_MODEL_METHOD = "_platform/session/pin_model";
