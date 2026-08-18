import type { z } from "zod";
import type { Result } from "../../result.js";
import type {
  skillDeleteLocalInputSchema,
  skillInstallInputSchema,
  skillPublishInputSchema,
  skillListLocalInputSchema,
  skillReadLocalInputSchema,
  skillReadPullRequestInputSchema,
  skillReadSkillFileInputSchema,
  skillScanInputSchema,
  skillUninstallInputSchema,
  skillWriteLocalInputSchema,
} from "./schemas.js";

export type SkillInstallInput = z.infer<typeof skillInstallInputSchema>;
export type SkillUninstallInput = z.infer<typeof skillUninstallInputSchema>;
export type SkillScanInput = z.infer<typeof skillScanInputSchema>;
export type SkillPublishInput = z.infer<typeof skillPublishInputSchema>;
export type SkillListLocalInput = z.infer<typeof skillListLocalInputSchema>;
export type SkillReadLocalInput = z.infer<typeof skillReadLocalInputSchema>;
export type SkillReadPullRequestInput = z.infer<
  typeof skillReadPullRequestInputSchema
>;
export type SkillReadSkillFileInput = z.infer<
  typeof skillReadSkillFileInputSchema
>;
export type SkillDeleteLocalInput = z.infer<typeof skillDeleteLocalInputSchema>;
export type SkillWriteLocalInput = z.infer<typeof skillWriteLocalInputSchema>;

export interface ScannedSkill {
  source: string;
  name: string;
  description: string;
  version: string;
  contentHash: string;
  dir: string;
}

export type SkillOrigin = "system" | "system-modified" | "user";

export interface LocalSkill {
  name: string;
  description: string;
  skillPath: string;
  origin?: SkillOrigin;
  contentHash?: string;
}

export interface LocalSkillFile {
  relPath: string;
  content: string;
  base64?: true;
}

export interface PullRequestDisposition {
  state: "open" | "closed";
  draft: boolean;
  mergedAt: string | null;
}

export interface SkillReadLocalResult {
  dir: string;
  files: LocalSkillFile[];
}

export interface SkillInstallResult {
  contentHash: string;
}

export interface SkillPublishResult {
  prUrl: string;
  branch: string;
}

export interface GitHubErrorBody {
  error?: string;
  message?: string;
  connect_url?: string;
  manage_url?: string;
  provider?: string;
}

export const SOURCE_PATH_REASONS = ["path-missing", "path-empty"] as const;

export type SourcePathReason = (typeof SOURCE_PATH_REASONS)[number];

export type SkillsDomainError =
  | { kind: "InvalidSkillName"; name: string; reason: string }
  | { kind: "InvalidSkillPath"; path: string; reason: string }
  | { kind: "SkillNotFound"; name: string; skillPaths: string[] }
  | { kind: "SkillNotFoundInSource"; source: string; name: string }
  | { kind: "SkillAlreadyExists"; names: string[] }
  | { kind: "PayloadTooLarge"; detail: string }
  | { kind: "SourceFetchFailed"; source: string; detail: string }
  | {
      kind: "SourcePathNotFound";
      source: string;
      path: string;
      version?: string;
    }
  | { kind: "SourcePathEmpty"; source: string; path: string; version?: string }
  | {
      kind: "UpstreamGitHubError";
      method: string;
      path: string;
      status: number;
      body: GitHubErrorBody;
    }
  | {
      kind: "UpstreamUnreachable";
      method: string;
      path: string;
      detail: string;
    };

export interface SkillsService {
  install: (
    input: SkillInstallInput,
  ) => Promise<Result<SkillInstallResult, SkillsDomainError>>;
  uninstall: (
    input: SkillUninstallInput,
  ) => Promise<Result<void, SkillsDomainError>>;
  listLocal: (
    input?: SkillListLocalInput,
  ) => Promise<Result<LocalSkill[], SkillsDomainError>>;
  readLocal: (
    input: SkillReadLocalInput,
  ) => Promise<Result<SkillReadLocalResult, SkillsDomainError>>;
  readPullRequest: (
    input: SkillReadPullRequestInput,
  ) => Promise<Result<PullRequestDisposition, SkillsDomainError>>;
  deleteLocal: (
    input: SkillDeleteLocalInput,
  ) => Promise<Result<void, SkillsDomainError>>;
  writeLocal: (
    input: SkillWriteLocalInput,
  ) => Promise<Result<LocalSkill[], SkillsDomainError>>;
  readSkillFile: (
    input: SkillReadSkillFileInput,
  ) => Promise<Result<{ content: string }, SkillsDomainError>>;
  scan: (
    input: SkillScanInput,
  ) => Promise<Result<ScannedSkill[], SkillsDomainError>>;
  publish: (
    input: SkillPublishInput,
  ) => Promise<Result<SkillPublishResult, SkillsDomainError>>;
}
