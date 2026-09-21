import { workspaceSeedEventPayload } from "agent-runtime-api";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
} from "../../git/protocol-client.js";

async function marked(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

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
    const marker = (name: string) =>
      join(ctx.pluginStateDir, into === "home" ? `home-${name}` : name);
    const done = marker(DONE_SENTINEL);
    const started = marker(STARTED_SENTINEL);
    if (await marked(done)) {
      deps.log(`[workspace-seed] ${dest} already seeded, skipping`);
      return;
    }
    const hasGit = existsSync(join(dest, ".git"));
    const ours = await marked(started);
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
        seed(workspaceSeedEventPayload.parse(payload), ctx);
    },
  };
}
