import type { z } from "zod";
import type { Result } from "../../result.js";
import type {
  skillInstallInputSchema,
  skillListLocalInputSchema,
  skillPublishInputSchema,
  skillReadLocalInputSchema,
  skillScanInputSchema,
  skillUninstallInputSchema,
} from "./schemas.js";

export type SkillInstallInput = z.infer<typeof skillInstallInputSchema>;
export type SkillUninstallInput = z.infer<typeof skillUninstallInputSchema>;
export type SkillScanInput = z.infer<typeof skillScanInputSchema>;
export type SkillPublishInput = z.infer<typeof skillPublishInputSchema>;
export type SkillListLocalInput = z.infer<typeof skillListLocalInputSchema>;
export type SkillReadLocalInput = z.infer<typeof skillReadLocalInputSchema>;

export interface ScannedSkill {
  source: string;
  name: string;
  description: string;
  version: string;
  contentHash: string;
}

export interface LocalSkill {
  name: string;
  description: string;
  skillPath: string;
}

export interface LocalSkillFile {
  relPath: string;
  content: string;
  base64?: true;
}

export interface SkillReadLocalResult {
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

export type SkillsDomainError =
  | { kind: "InvalidSkillName"; name: string; reason: string }
  | { kind: "InvalidSkillPath"; path: string; reason: string }
  | { kind: "SkillNotFound"; name: string; skillPaths: string[] }
  | { kind: "SkillNotFoundInSource"; source: string; name: string }
  | { kind: "PayloadTooLarge"; detail: string }
  | { kind: "SourceFetchFailed"; source: string; detail: string }
  | {
      kind: "UpstreamGitHubError";
      method: string;
      path: string;
      status: number;
      body: GitHubErrorBody;
    };

export interface SkillsService {
  install: (
    input: SkillInstallInput,
  ) => Promise<Result<SkillInstallResult, SkillsDomainError>>;
  uninstall: (
    input: SkillUninstallInput,
  ) => Promise<Result<void, SkillsDomainError>>;
  listLocal: (
    input: SkillListLocalInput,
  ) => Promise<Result<LocalSkill[], SkillsDomainError>>;
  readLocal: (
    input: SkillReadLocalInput,
  ) => Promise<Result<SkillReadLocalResult, SkillsDomainError>>;
  scan: (
    input: SkillScanInput,
  ) => Promise<Result<ScannedSkill[], SkillsDomainError>>;
  publish: (
    input: SkillPublishInput,
  ) => Promise<Result<SkillPublishResult, SkillsDomainError>>;
}
