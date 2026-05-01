import { z } from "zod/v4";
import type { Result } from "../../result.js";

export const installSkillInput = z.object({
  source: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
});
export type InstallSkillInput = z.infer<typeof installSkillInput>;

export const uninstallSkillInput = z.object({
  name: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
});
export type UninstallSkillInput = z.infer<typeof uninstallSkillInput>;

export const scanSkillSourceInput = z.object({
  source: z.string().min(1),
});
export type ScanSkillSourceInput = z.infer<typeof scanSkillSourceInput>;

export const publishSkillInput = z.object({
  name: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
});
export type PublishSkillInput = z.infer<typeof publishSkillInput>;

export const listLocalSkillsInput = z.object({
  skillPaths: z.array(z.string().min(1)).min(1),
});
export type ListLocalSkillsInput = z.infer<typeof listLocalSkillsInput>;

export const readLocalSkillInput = z.object({
  name: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
});
export type ReadLocalSkillInput = z.infer<typeof readLocalSkillInput>;

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

export interface ReadLocalSkillResult {
  files: LocalSkillFile[];
}

export interface InstallSkillResult {
  contentHash: string;
}

export interface PublishSkillResult {
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
  | { kind: "UpstreamGitHubError"; method: string; path: string; status: number; body: GitHubErrorBody };

export interface SkillsService {
  install: (input: InstallSkillInput) => Promise<Result<InstallSkillResult, SkillsDomainError>>;
  uninstall: (input: UninstallSkillInput) => Promise<Result<void, SkillsDomainError>>;
  listLocal: (input: ListLocalSkillsInput) => Promise<Result<LocalSkill[], SkillsDomainError>>;
  readLocal: (input: ReadLocalSkillInput) => Promise<Result<ReadLocalSkillResult, SkillsDomainError>>;
  scan: (input: ScanSkillSourceInput) => Promise<Result<ScannedSkill[], SkillsDomainError>>;
  publish: (input: PublishSkillInput) => Promise<Result<PublishSkillResult, SkillsDomainError>>;
}
