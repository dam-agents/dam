import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  DriverBinding,
  EventContext,
  EventHandler,
  Plugin,
  Result,
  SkillsDomainError,
  WorkspaceSeedEventPayload,
} from "agent-runtime-api";

import { createGitProtocolClient } from "../../skills/infrastructure/git-protocol-client.js";

const IMPL_NAME = "workspace-seed";
const DONE_SENTINEL = "seed.done";
const STARTED_SENTINEL = "seed.started";
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export type CloneFn = (
  url: string,
  dest: string,
  ref?: string,
) => Promise<Result<void, SkillsDomainError>>;

export type FetchIntoFn = (
  url: string,
  dest: string,
  ref?: string,
) => Promise<Result<void, SkillsDomainError>>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Seeds the work directory from a repository
 * exactly once. Completion is a sentinel in the plugin's state dir — a `.git`
 * alone proves nothing, since a failed attempt or the agent's own clone leaves
 * one too. A first attempt at a branch or tag is a shallow clone; a commit sha
 * (what a starter kit's seed resolves to), or any retry over an attempt this
 * plugin started, is fetched in place — never by removing the directory,
 * which is the harness's cwd. A `.git` it did not start is someone else's
 * work and is refused, so the failure is reported rather than papered over.
 */
export function createWorkspaceSeedPlugin(deps: {
  workDir: string;
  clone?: CloneFn;
  fetchInto?: FetchIntoFn;
  log: (msg: string) => void;
}): Plugin {
  const clone: CloneFn =
    deps.clone ??
    ((url, dest, ref) =>
      createGitProtocolClient().cloneShallow(url, dest, 50, ref));
  const fetchInto: FetchIntoFn =
    deps.fetchInto ??
    ((url, dest, ref) => createGitProtocolClient().fetchInto(url, dest, ref));

  const seed = async (
    { url, ref }: WorkspaceSeedEventPayload,
    ctx: EventContext,
  ): Promise<void> => {
    const at = ref ? ` (${ref})` : "";
    const done = join(ctx.pluginStateDir, DONE_SENTINEL);
    const started = join(ctx.pluginStateDir, STARTED_SENTINEL);
    if (existsSync(done)) {
      deps.log(`[workspace-seed] ${deps.workDir} already seeded, skipping`);
      return;
    }
    const hasGit = existsSync(join(deps.workDir, ".git"));
    const ours = existsSync(started);
    if (hasGit && !ours) {
      throw new Error(
        `refusing to seed ${deps.workDir}: it already holds a repository the platform did not seed`,
      );
    }
    if (
      !hasGit &&
      existsSync(deps.workDir) &&
      readdirSync(deps.workDir).length > 0
    ) {
      throw new Error(
        `refusing to seed a non-empty work directory: ${deps.workDir}`,
      );
    }
    await mkdir(ctx.pluginStateDir, { recursive: true });
    await writeFile(started, `${new Date().toISOString()}\n`, { flag: "a" });
    const inPlace = hasGit || (ref !== undefined && COMMIT_SHA.test(ref));
    deps.log(
      `[workspace-seed] ${inPlace ? "fetching" : "cloning"} ${url}${at} into ${deps.workDir}`,
    );
    const res = inPlace
      ? await fetchInto(url, deps.workDir, ref)
      : await clone(url, deps.workDir, ref);
    if (!res.ok) {
      const e = res.error;
      const detail = "detail" in e ? `: ${e.detail}` : "";
      throw new Error(
        `workspace seed of ${url}${at} failed (${e.kind})${detail}`,
      );
    }
    await writeFile(done, `${new Date().toISOString()}\n`, { flag: "a" });
    deps.log(`[workspace-seed] seeded ${deps.workDir} from ${url}${at}`);
  };

  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "workspace-seed") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload, ctx) =>
        seed(payload as WorkspaceSeedEventPayload, ctx);
    },
  };
}
