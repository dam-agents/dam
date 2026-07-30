import type { z } from "zod";
import type { Result } from "../../result.js";
import type {
  skillDeleteLocalInputSchema,
  skillInstallInputSchema,
  skillPublishInputSchema,
  skillReadLocalInputSchema,
  skillScanInputSchema,
  skillUninstallInputSchema,
  skillWriteLocalInputSchema,
} from "./schemas.js";

export type SkillInstallInput = z.infer<typeof skillInstallInputSchema>;
export type SkillUninstallInput = z.infer<typeof skillUninstallInputSchema>;
export type SkillScanInput = z.infer<typeof skillScanInputSchema>;
export type SkillPublishInput = z.infer<typeof skillPublishInputSchema>;
export type SkillReadLocalInput = z.infer<typeof skillReadLocalInputSchema>;
export type SkillDeleteLocalInput = z.infer<typeof skillDeleteLocalInputSchema>;
export type SkillWriteLocalInput = z.infer<typeof skillWriteLocalInputSchema>;

export interface ScannedSkill {
  source: string;
  name: string;
  description: string;
  version: string;
  contentHash: string;
}

/** Provenance vs. the image's pristine workspace copy: shipped untouched,
 *  shipped but diverged on the PVC, or created at runtime. */
export type SkillOrigin = "system" | "system-modified" | "user";

export interface LocalSkill {
  name: string;
  description: string;
  skillPath: string;
  /** Absent on pre-provenance agent-runtimes — readers treat as `user`. */
  origin?: SkillOrigin;
}

export interface LocalSkillFile {
  relPath: string;
  content: string;
  base64?: true;
}

export interface SkillReadLocalResult {
  /** The skill's on-disk directory basename — may differ from the requested
   *  name, which is the frontmatter `name:` for anything writeLocal created. */
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

export type SkillsDomainError =
  | { kind: "InvalidSkillName"; name: string; reason: string }
  | { kind: "InvalidSkillPath"; path: string; reason: string }
  | { kind: "SkillNotFound"; name: string; skillPaths: string[] }
  | { kind: "SkillNotFoundInSource"; source: string; name: string }
  | { kind: "SkillAlreadyExists"; names: string[] }
  | { kind: "PayloadTooLarge"; detail: string }
  | { kind: "SourceFetchFailed"; source: string; detail: string }
  | {
      kind: "UpstreamGitHubError";
      method: string;
      path: string;
      status: number;
      body: GitHubErrorBody;
    }
  /** The request to GitHub never produced an HTTP response — the pod's only
   *  route there is the paired gateway, so this means egress was denied or
   *  the gateway is down, never a GitHub-side verdict. */
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
  listLocal: () => Promise<Result<LocalSkill[], SkillsDomainError>>;
  readLocal: (
    input: SkillReadLocalInput,
  ) => Promise<Result<SkillReadLocalResult, SkillsDomainError>>;
  deleteLocal: (
    input: SkillDeleteLocalInput,
  ) => Promise<Result<void, SkillsDomainError>>;
  writeLocal: (
    input: SkillWriteLocalInput,
  ) => Promise<Result<LocalSkill[], SkillsDomainError>>;
  scan: (
    input: SkillScanInput,
  ) => Promise<Result<ScannedSkill[], SkillsDomainError>>;
  publish: (
    input: SkillPublishInput,
  ) => Promise<Result<SkillPublishResult, SkillsDomainError>>;
}
