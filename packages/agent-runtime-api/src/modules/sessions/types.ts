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
  sessionSettingsInputSchema,
  setSessionTitleInputSchema,
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
  // UNIT_BOUNDARY_DESCRIPTION: set when the harness had not answered in time, so sessions only the harness knows may be missing; a reader must not take a session's absence from this page as its removal. A notice follows once the full list is ready.
  incomplete?: true;
}

export type SetSessionTitleInput = z.infer<typeof setSessionTitleInputSchema>;
export type SessionSettingsInput = z.infer<typeof sessionSettingsInputSchema>;

export type SessionHistoryInput = z.infer<typeof sessionHistoryInputSchema>;
export type SessionHistory = z.infer<typeof sessionHistorySchema>;
export type StoreDelegationFramesInput = z.infer<
  typeof storeDelegationFramesInputSchema
>;
export type DelegationFrames = z.infer<typeof delegationFramesSchema>;

export interface SessionsService {
  list(query?: SessionListQuery): Promise<SessionPage>;
  watch(signal?: AbortSignal): AsyncIterable<PodSessionNotice>;
  history(
    sessionId: string,
    opts?: Pick<SessionHistoryInput, "tail">,
  ): Promise<SessionHistory>;
  setTitle(input: SetSessionTitleInput): Promise<boolean>;
  // UNIT_BOUNDARY_DESCRIPTION: null for a session the platform does not track; read by the api-server so a platform sub-agent spawned from the session defaults to its subagent model.
  settings(input: SessionSettingsInput): Promise<Record<string, string> | null>;
  byRef(ref: string): Promise<string | null>;
  storeDelegationFrames(
    input: StoreDelegationFramesInput,
  ): Promise<{ truncated: boolean }>;
  delegationFrames(invocationId: string): Promise<DelegationFrames | null>;
  spend(input: SessionSpendInput): Promise<SessionSpendTotal | null>;
}

export type SessionDirectoryEntry = z.infer<typeof sessionDirectoryEntrySchema>;

export const PIN_MODEL_METHOD = "_platform/session/pin_model";
export const CONFIGURE_SESSION_METHOD = "_platform/session/configure";
