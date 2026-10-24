import type { z } from "zod";
import type {
  sessionNoticeSchema,
  sessionModeSchema,
  sessionSchema,
  sessionTypeSchema,
  sessionHistoryInputSchema,
  sessionHistorySchema,
  storeDelegationFramesInputSchema,
  delegationFramesSchema,
  sessionCategorySchema,
  sessionDirectoryEntrySchema,
  sessionListCursorSchema,
  sessionListInputSchema,
  sessionSettingsInputSchema,
  setSessionTitleInputSchema,
} from "./schemas.js";
import type { SubAgentHarnessConfig } from "../harness-config/session-settings.js";

// UNIT_BOUNDARY_DESCRIPTION: a runtime older than platform sub-agent settings answers with the settings alone, so the harness and the inherited config may be absent.
export interface SessionSubAgentContext {
  settings: Record<string, string>;
  harness?: string;
  inherited?: SubAgentHarnessConfig;
}

export type SessionMode = z.infer<typeof sessionModeSchema>;
export type SessionType = z.infer<typeof sessionTypeSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionNotice = z.infer<typeof sessionNoticeSchema>;
export type SessionCategory = z.infer<typeof sessionCategorySchema>;
export type SessionListCursor = z.infer<typeof sessionListCursorSchema>;
export type SessionListQuery = NonNullable<
  z.infer<typeof sessionListInputSchema>
>;

export interface SessionPage {
  sessions: Session[];
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
  watch(signal?: AbortSignal): AsyncIterable<SessionNotice>;
  history(
    sessionId: string,
    opts?: Pick<SessionHistoryInput, "tail">,
  ): Promise<SessionHistory>;
  setTitle(input: SetSessionTitleInput): Promise<boolean>;
  // UNIT_BOUNDARY_DESCRIPTION: null for a session the platform does not track; read by the api-server when the session spawns a platform sub-agent, which follows the session's platform sub-agent settings and, on the session's own harness, takes the session's model and settings.
  settings(input: SessionSettingsInput): Promise<SessionSubAgentContext | null>;
  byRef(ref: string): Promise<string | null>;
  storeDelegationFrames(
    input: StoreDelegationFramesInput,
  ): Promise<{ truncated: boolean }>;
  delegationFrames(invocationId: string): Promise<DelegationFrames | null>;
}

export type SessionDirectoryEntry = z.infer<typeof sessionDirectoryEntrySchema>;

export const PIN_MODEL_METHOD = "_platform/session/pin_model";
export const NO_MODEL_REASON = "no-model";
export const CONFIGURE_SESSION_METHOD = "_platform/session/configure";
