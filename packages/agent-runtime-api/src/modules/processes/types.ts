import type { z } from "zod";
import type { Result } from "../../result.js";
import type {
  finishedRowSchema,
  keepMarkRequestSchema,
  keepSourceSchema,
  pendingRestartSchema,
  processKindSchema,
  processListSchema,
  processNoticeSchema,
  processOutputSchema,
  processRowSchema,
} from "./schemas.js";

export type ProcessKind = z.infer<typeof processKindSchema>;
export type KeepSource = z.infer<typeof keepSourceSchema>;
export type ProcessRow = z.infer<typeof processRowSchema>;
export type FinishedRow = z.infer<typeof finishedRowSchema>;
export type PendingRestart = z.infer<typeof pendingRestartSchema>;
export type ProcessList = z.infer<typeof processListSchema>;
export type ProcessOutput = z.infer<typeof processOutputSchema>;
export type ProcessNotice = z.infer<typeof processNoticeSchema>;
export type KeepMarkRequest = z.infer<typeof keepMarkRequestSchema>;

export type ProcessesDomainError =
  { kind: "NotFound"; key: string } | { kind: "NotAllowed"; message: string };

export interface NothingPending {
  kind: "NothingPending";
}

export interface ProcessesService {
  list(): Promise<ProcessList>;
  watch(signal?: AbortSignal): AsyncIterable<ProcessNotice>;
  output(key: string): Promise<Result<ProcessOutput, ProcessesDomainError>>;
  setKeep(
    key: string,
    keepsAwake: boolean,
  ): Promise<Result<void, ProcessesDomainError>>;
  stop(key: string): Promise<Result<void, ProcessesDomainError>>;
  applyPendingRestart(): Promise<Result<void, NothingPending>>;
}
