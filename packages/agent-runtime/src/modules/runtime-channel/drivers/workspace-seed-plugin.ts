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

import {
  createGitProtocolClient,
  type SeedTarget,
} from "../../skills/infrastructure/git-protocol-client.js";

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
  target: SeedTarget,
) => Promise<Result<void, SkillsDomainError>>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Seeds a directory from a repository exactly
 * once — the work directory, or the agent's home when the seed says so (a
 * definition that wants to be `$HOME`, with `work/` as its data directory).
 * Completion is a sentinel in the plugin's state dir — a `.git` alone proves
 * nothing, since a failed attempt or the agent's own clone leaves one too. A
 * plain ref into an empty work directory is a shallow clone; everything else
 * — a pinned commit, a branch to stay on, the home directory, a retry over an
 * attempt this plugin started — is fetched in place: init, fetch, hard-reset
 * of tracked paths, checkout of the branch. Never by removing the directory,
 * which is the harness's cwd or home. A `.git` it did not start is someone
 * else's work and is refused, so the failure is reported rather than papered
 * over.
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
    ((url, dest, target) =>
      createGitProtocolClient().fetchInto(url, dest, target));

  const seed = async (
    { url, ref, commit, branch, into }: WorkspaceSeedEventPayload,
    ctx: EventContext,
  ): Promise<void> => {
    const dest = into === "home" ? ctx.agentHome : deps.workDir;
    const at = [branch, commit ?? ref].filter(Boolean).join(" @ ");
    const label = at ? `${url} (${at})` : url;
    const done = join(ctx.pluginStateDir, DONE_SENTINEL);
    const started = join(ctx.pluginStateDir, STARTED_SENTINEL);
    if (existsSync(done)) {
      deps.log(`[workspace-seed] ${dest} already seeded, skipping`);
      return;
    }
    const hasGit = existsSync(join(dest, ".git"));
    const ours = existsSync(started);
    if (hasGit && !ours) {
      throw new Error(
        `refusing to seed ${dest}: it already holds a repository the platform did not seed`,
      );
    }
    const intoHome = into === "home";
    if (
      !intoHome &&
      !hasGit &&
      existsSync(dest) &&
      readdirSync(dest).length > 0
    ) {
      throw new Error(`refusing to seed a non-empty work directory: ${dest}`);
    }
    await mkdir(ctx.pluginStateDir, { recursive: true });
    await writeFile(started, `${new Date().toISOString()}\n`, { flag: "a" });
    const plainRef =
      commit === undefined &&
      branch === undefined &&
      !COMMIT_SHA.test(ref ?? "");
    const inPlace = intoHome || hasGit || !plainRef;
    deps.log(
      `[workspace-seed] ${inPlace ? "fetching" : "cloning"} ${label} into ${dest}`,
    );
    const res = inPlace
      ? await fetchInto(url, dest, { ref, commit, branch })
      : await clone(url, dest, ref);
    if (!res.ok) {
      const e = res.error;
      const detail = "detail" in e ? `: ${e.detail}` : "";
      throw new Error(`workspace seed of ${label} failed (${e.kind})${detail}`);
    }
    await writeFile(done, `${new Date().toISOString()}\n`, { flag: "a" });
    deps.log(`[workspace-seed] seeded ${dest} from ${label}`);
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
