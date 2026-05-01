import * as path from "node:path";
import type {
  Result,
  ScanSkillSourceInput,
  ScannedSkill,
  SkillsDomainError,
} from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";
import {
  detectGithubOwnerRepo,
  type DetectedOwnerRepo,
  type GitHubRestClient,
} from "../infrastructure/github-rest-client.js";
import type { GitProtocolClient } from "../infrastructure/git-protocol-client.js";
import type { LocalSkillRepository } from "../infrastructure/local-skill-repository.js";

export interface ScanDeps {
  github: GitHubRestClient;
  git: GitProtocolClient;
  repo: LocalSkillRepository;
}

/**
 * Enumerate skills in a remote git source. GitHub URLs walk through
 * api.github.com (commit-head + tarball) so OneCLI's stable Bearer-sentinel
 * swap is on the hot path; non-GitHub URLs fall back to anonymous git clone.
 *
 * Trade-off: `version` is the source's HEAD commit at scan time, uniform
 * across the catalogue. Drift detection lights the Update badge whenever the
 * source gets *any* commit, not only when a skill dir was touched. Click
 * still does the right thing (re-installs at HEAD); just noisier.
 */
export async function runScan(
  deps: ScanDeps,
  input: ScanSkillSourceInput,
): Promise<Result<ScannedSkill[], SkillsDomainError>> {
  const host = detectGithubOwnerRepo(input.source);
  if (host) return scanGithub(deps, input.source, host);
  return scanGitClone(deps, input.source);
}

async function scanGithub(
  deps: ScanDeps,
  source: string,
  host: DetectedOwnerRepo,
): Promise<Result<ScannedSkill[], SkillsDomainError>> {
  // Anonymous preflight. OneCLI passes public repos through and auto-injects
  // the user's token for private repos when they're Connected — happy path is
  // one call. A 404 here is ambiguous: truly-not-found OR private + not
  // Connected. Retry with the sentinel so OneCLI's gateway can return the
  // structured `app_not_connected` / `access_restricted` CTA the UI renders.
  let head = await deps.github.getCommitHead(host, { withAuth: false });
  if (!head.ok && head.error.kind === "UpstreamGitHubError" && head.error.status === 404) {
    head = await deps.github.getCommitHead(host, { withAuth: true });
  }
  if (!head.ok) return head;
  const version = head.value.sha;

  // Tarball is served by api.github.com (with a redirect to codeload that
  // OneCLI follows transparently — verified empirically). For a typical
  // skill repo this is ~50–500 KB.
  const tarball = await deps.github.fetchTarball(host, version, { withAuth: false });
  if (!tarball.ok) return tarball;

  return deps.repo.withTempDir("humr-skills-scan-", async (tmp) => {
    await deps.repo.extractTarball(tarball.value, tmp, {});
    // GitHub tarballs wrap contents in a single top-level dir like
    // `{owner}-{repo}-{short-sha}` — find it and scan from there.
    const fs = await import("node:fs/promises");
    const extracted = (await fs.readdir(tmp, { withFileTypes: true })).filter((e) => e.isDirectory());
    if (extracted.length === 0) {
      return err({ kind: "SourceFetchFailed", source, detail: "tarball contained no directories" });
    }
    const repoDir = path.join(tmp, extracted[0].name);

    return collectSkills(deps, source, repoDir, version);
  });
}

async function scanGitClone(
  deps: ScanDeps,
  source: string,
): Promise<Result<ScannedSkill[], SkillsDomainError>> {
  return deps.repo.withTempDir("humr-skills-scan-", async (tmp) => {
    const cloned = await deps.git.cloneShallow(source, tmp, 50);
    if (!cloned.ok) return cloned;

    const skillDirs = await deps.repo.findSkillDirsInClone(tmp);
    const out: ScannedSkill[] = [];
    for (const rel of skillDirs) {
      const absDir = path.join(tmp, rel);
      const fm = await deps.repo.readSkillManifest(absDir);
      const versionRes = await deps.git.lastTouchingSha(tmp, rel);
      if (!versionRes.ok) return versionRes;
      const contentHash = await deps.repo.hashSkillDir(absDir);
      out.push({
        source,
        name: fm.name?.trim() || path.basename(rel),
        description: fm.description?.trim() || "",
        version: versionRes.value,
        contentHash,
      });
    }
    return ok(out.sort((a, b) => a.name.localeCompare(b.name)));
  });
}

async function collectSkills(
  deps: ScanDeps,
  source: string,
  repoDir: string,
  version: string,
): Promise<Result<ScannedSkill[], SkillsDomainError>> {
  const skillDirs = await deps.repo.findSkillDirsInClone(repoDir);
  const out = await Promise.all(
    skillDirs.map(async (rel) => {
      const absDir = path.join(repoDir, rel);
      const fm = await deps.repo.readSkillManifest(absDir);
      const contentHash = await deps.repo.hashSkillDir(absDir);
      return {
        source,
        name: fm.name?.trim() || path.basename(rel),
        description: fm.description?.trim() || "",
        version,
        contentHash,
      };
    }),
  );
  return ok(out.sort((a, b) => a.name.localeCompare(b.name)));
}
