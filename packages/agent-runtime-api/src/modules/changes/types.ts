import type { z } from "zod";
import type { Result } from "../../result.js";
import type {
  changeSetDiffSchema,
  changeSetListSchema,
  changeSetSchema,
  changesNoticeSchema,
  compareToSchema,
  diffStatSchema,
  fileChangeStatusSchema,
  fileDiffSchema,
  pullRequestLinkSchema,
  pullRequestStateSchema,
  sessionRepositorySchema,
} from "./schemas.js";

export type CompareTo = z.infer<typeof compareToSchema>;
export type PullRequestLink = z.infer<typeof pullRequestLinkSchema>;
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;
export type DiffStat = z.infer<typeof diffStatSchema>;
export type ChangeSet = z.infer<typeof changeSetSchema>;
export type ChangeSetList = z.infer<typeof changeSetListSchema>;
export type FileChangeStatus = z.infer<typeof fileChangeStatusSchema>;
export type FileDiff = z.infer<typeof fileDiffSchema>;
export type ChangeSetDiff = z.infer<typeof changeSetDiffSchema>;
export type SessionRepository = z.infer<typeof sessionRepositorySchema>;
export type ChangesNotice = z.infer<typeof changesNoticeSchema>;

export type ChangesDomainError =
  { kind: "NotFound"; path: string } | { kind: "GitFailed"; message: string };

export interface ChangesService {
  list(sessionId?: string): Promise<ChangeSetList>;
  diff(
    path: string,
    compare: CompareTo,
  ): Promise<Result<ChangeSetDiff, ChangesDomainError>>;
  watch(signal?: AbortSignal): AsyncIterable<ChangesNotice>;
}
