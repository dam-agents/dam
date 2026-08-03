import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  DriverBinding,
  EventHandler,
  Plugin,
  Result,
  SkillsDomainError,
  WorkspaceSeedEventPayload,
} from "agent-runtime-api";
import { createGitProtocolClient } from "../../skills/infrastructure/git-protocol-client.js";

const IMPL_NAME = "workspace-seed";

// Clone fn, injectable for tests; defaults to GitProtocolClient (proxy + CA aware).
export type CloneFn = (
  url: string,
  dest: string,
  ref?: string,
) => Promise<Result<void, SkillsDomainError>>;

// Event driver for `workspace-seed`: clone a repo into the work dir once.
// Dirty-safe — skips if already seeded, refuses a non-empty work dir.
export function createWorkspaceSeedPlugin(deps: {
  workDir: string;
  clone?: CloneFn;
  log: (msg: string) => void;
}): Plugin {
  const clone: CloneFn =
    deps.clone ??
    ((url, dest, ref) =>
      createGitProtocolClient().cloneShallow(url, dest, 50, ref));

  const seed = async ({
    url,
    ref,
  }: WorkspaceSeedEventPayload): Promise<void> => {
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

  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "workspace-seed") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload) => seed(payload as WorkspaceSeedEventPayload);
    },
  };
}
