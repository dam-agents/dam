import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Result,
  SkillsDomainError,
  WorkspaceSeedEventPayload,
} from "agent-runtime-api";
import { createGitProtocolClient } from "../skills/infrastructure/git-protocol-client.js";

/** Clone fn, injectable for tests; defaults to GitProtocolClient (proxy + CA aware). */
export type CloneFn = (
  url: string,
  dest: string,
) => Promise<Result<void, SkillsDomainError>>;

export type SeedWorkspaceFn = (
  payload: WorkspaceSeedEventPayload,
) => Promise<void>;

/**
 * Handler for the one-shot `workspace-seed` event: clone a public repo into the
 * work dir, once. Dirty-safe: `.git` present → skip; non-empty without `.git` →
 * throw; empty → clone (a real repo, with `.git`).
 */
export function createSeedWorkspace(deps: {
  workDir: string;
  clone?: CloneFn;
  log: (msg: string) => void;
}): SeedWorkspaceFn {
  const clone: CloneFn =
    deps.clone ??
    ((url, dest) => createGitProtocolClient().cloneShallow(url, dest));

  return async ({ sourceUrl }) => {
    if (existsSync(join(deps.workDir, ".git"))) {
      deps.log(`[workspace-seed] ${deps.workDir} already seeded, skipping`);
      return;
    }
    if (existsSync(deps.workDir) && readdirSync(deps.workDir).length > 0) {
      throw new Error(
        `refusing to seed a non-empty work directory: ${deps.workDir}`,
      );
    }
    deps.log(`[workspace-seed] cloning ${sourceUrl} into ${deps.workDir}`);
    const res = await clone(sourceUrl, deps.workDir);
    if (!res.ok) {
      const e = res.error;
      const detail = "detail" in e ? `: ${e.detail}` : "";
      throw new Error(
        `workspace seed of ${sourceUrl} failed (${e.kind})${detail}`,
      );
    }
    deps.log(`[workspace-seed] cloned ${sourceUrl} into ${deps.workDir}`);
  };
}
