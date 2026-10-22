import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  Result,
  SkillScanInput,
  ScannedSkill,
  SkillsDomainError,
} from "agent-runtime-api";
import { dedupeByName, err, ok } from "agent-runtime-api";
import { subPathEscapes } from "agent-runtime-api/skill-tree";
import type { SourcePathReason } from "agent-runtime-api";
import {
  anonymousFirst,
  detectGithubOwnerRepo,
  isGithubNotFound,
  type DetectedOwnerRepo,
  type GitHubRestClient,
  type GithubFetchOpts,
} from "../infrastructure/github-rest-client.js";
import type { GitProtocolClient } from "../../git/protocol-client.js";
import type { LocalSkillRepository } from "../infrastructure/local-skill-repository.js";
import { fetchGithubPath } from "./fetch-github-path.js";

export interface ScanDeps {
  github: GitHubRestClient;
  git: GitProtocolClient;
  repo: LocalSkillRepository;
  log: (msg: string) => void;
}

function sourcePathError(
  reason: SourcePathReason,
  source: string,
  subPath: string,
  version?: string,
): Result<never, SkillsDomainError> {
  return err({
    kind: reason === "path-missing" ? "SourcePathNotFound" : "SourcePathEmpty",
    source,
    path: subPath,
    ...(version !== undefined ? { version } : {}),
  });
}

export async function runScan(
  deps: ScanDeps,
  input: SkillScanInput,
): Promise<Result<ScannedSkill[], SkillsDomainError>> {
  const host = detectGithubOwnerRepo(input.source);
  const res = host
    ? await scanGithub(
        deps,
        input.source,
        host,
        input.path,
        input.fetch === "directory",
      )
    : await scanGitClone(deps, input.source, input.path);
  if (!res.ok) return res;
  const { kept, dropped } = dedupeByName(res.value);
  for (const d of dropped) {
    deps.log(
      `scan ${input.source}: dropped same-name skill "${d.name}" from a later source root`,
    );
  }
  return ok(kept);
}

async function scanGithub(
  deps: ScanDeps,
  source: string,
  host: DetectedOwnerRepo,
  subPath: string | undefined,
  byDirectory: boolean,
): Promise<Result<ScannedSkill[], SkillsDomainError>> {
  const dirPath =
    byDirectory && subPath && !subPathEscapes(subPath) ? subPath : undefined;
  const resolveHead = (opts: GithubFetchOpts) =>
    dirPath
      ? headOfDefaultBranch(deps.github, host, opts)
      : deps.github.getCommitHead(host, opts);
  const head = await anonymousFirst(resolveHead);
  if (!head.ok) return head;
  const version = head.value.sha;
  const fixedVersion = () => Promise.resolve(ok(version));

  if (dirPath) {
    return deps.repo.withTempDir("platform-skills-scan-", async (tmp) => {
      const fetched = await fetchGithubPath(deps, host, version, dirPath, tmp);
      if (isGithubNotFound(fetched)) {
        return sourcePathError("path-missing", source, dirPath, version);
      }
      if (!fetched.ok) return fetched;
      return collectSkills(deps, source, tmp, dirPath, version, fixedVersion);
    });
  }

  const tarball = await anonymousFirst((o) =>
    deps.github.fetchTarball(host, version, o),
  );
  if (!tarball.ok) return tarball;

  return deps.repo.withTempDir("platform-skills-scan-", async (tmp) => {
    await deps.repo.extractTarball(tarball.value, tmp, {});
    const extracted = (await fs.readdir(tmp, { withFileTypes: true })).filter(
      (e) => e.isDirectory(),
    );
    if (extracted.length === 0) {
      return err({
        kind: "SourceFetchFailed",
        source,
        detail: "tarball contained no directories",
      });
    }
    const repoDir = path.join(tmp, extracted[0].name);

    return collectSkills(deps, source, repoDir, subPath, version, fixedVersion);
  });
}

async function headOfDefaultBranch(
  github: GitHubRestClient,
  host: DetectedOwnerRepo,
  opts: GithubFetchOpts,
) {
  const repo = await github.getRepo(host, opts);
  if (!repo.ok) return repo;
  return github.getRef(host, repo.value.defaultBranch, opts);
}

async function scanGitClone(
  deps: ScanDeps,
  source: string,
  subPath?: string,
): Promise<Result<ScannedSkill[], SkillsDomainError>> {
  return deps.repo.withTempDir("platform-skills-scan-", async (tmp) => {
    const cloned = await deps.git.cloneShallow(source, tmp, 50);
    if (!cloned.ok) return cloned;
    return collectSkills(deps, source, tmp, subPath, undefined, (rel) =>
      deps.git.lastTouchingSha(tmp, rel),
    );
  });
}

async function collectSkills(
  deps: ScanDeps,
  source: string,
  repoDir: string,
  subPath: string | undefined,
  version: string | undefined,
  versionOf: (rel: string) => Promise<Result<string, SkillsDomainError>>,
): Promise<Result<ScannedSkill[], SkillsDomainError>> {
  const outcome = await deps.repo.findSkillDirsInClone(repoDir, subPath);
  if (outcome.kind !== "found") {
    return sourcePathError(outcome.kind, source, outcome.subPath, version);
  }
  const rows = await Promise.all(
    outcome.dirs.map(async (rel) => {
      const absDir = path.join(repoDir, rel);
      const fm = await deps.repo.readSkillManifest(absDir);
      const found = await versionOf(rel);
      if (!found.ok) return found;
      return ok({
        source,
        name: fm.name?.trim() || path.basename(rel),
        description: fm.description?.trim() || "",
        version: found.value,
        contentHash: await deps.repo.hashSkillDir(absDir),
        dir: rel,
      });
    }),
  );
  const out: ScannedSkill[] = [];
  for (const row of rows) {
    if (!row.ok) return row;
    out.push(row.value);
  }
  return ok(out.sort((a, b) => a.name.localeCompare(b.name)));
}
