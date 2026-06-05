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
  ref?: string,
) => Promise<Result<void, SkillsDomainError>>;

export type SeedWorkspaceFn = (
  payload: WorkspaceSeedEventPayload,
) => Promise<void>;

/** One-shot `workspace-seed` event handler: clone a public repo (optionally a
 *  branch/tag) into the work dir, once. Dirty-safe (see the branch logic below). */
export function createSeedWorkspace(deps: {
  workDir: string;
  clone?: CloneFn;
  log: (msg: string) => void;
}): SeedWorkspaceFn {
  const clone: CloneFn =
    deps.clone ??
    ((url, dest, ref) =>
      createGitProtocolClient().cloneShallow(url, dest, 50, ref));

  return async ({ url, ref }) => {
    const at = ref ? ` (${ref})` : "";
    if (existsSync(join(deps.workDir, ".git"))) {
      deps.log(`[workspace-seed] ${deps.workDir} already seeded, skipping`);
      return;
    }
    if (existsSync(deps.workDir) && readdirSync(deps.workDir).length > 0) {
      throw new Error(
        `refusing to seed a non-empty work directory: ${deps.workDir}`,
      );
    }
    deps.log(`[workspace-seed] cloning ${url}${at} into ${deps.workDir}`);
    const res = await clone(url, deps.workDir, ref);
    if (!res.ok) {
      const e = res.error;
      const detail = "detail" in e ? `: ${e.detail}` : "";
      throw new Error(
        `workspace seed of ${url}${at} failed (${e.kind})${detail}`,
      );
    }
    deps.log(`[workspace-seed] cloned ${url}${at} into ${deps.workDir}`);
  };
}
