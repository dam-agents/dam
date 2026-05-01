import type {
  InstallSkillInput,
  InstallSkillResult,
  Result,
  SkillsDomainError,
} from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";
import type { SkillName } from "../domain/skill-name.js";
import type { SkillPath } from "../domain/skill-path.js";
import {
  detectGithubOwnerRepo,
  type GitHubRestClient,
} from "../infrastructure/github-rest-client.js";
import type { GitProtocolClient } from "../infrastructure/git-protocol-client.js";
import type { LocalSkillRepository } from "../infrastructure/local-skill-repository.js";

export interface InstallDeps {
  github: GitHubRestClient;
  git: GitProtocolClient;
  repo: LocalSkillRepository;
}

export async function runInstall(
  deps: InstallDeps,
  name: SkillName,
  skillPaths: SkillPath[],
  input: InstallSkillInput,
): Promise<Result<InstallSkillResult, SkillsDomainError>> {
  return deps.repo.withTempDir("humr-skill-", async (tmp) => {
    const fetched = await fetchSourceAtVersion(deps, input.source, input.version, tmp);
    if (!fetched.ok) return fetched;

    const srcDirRes = await deps.repo.resolveSkillDirInClone(tmp, name);
    if (!srcDirRes.ok) {
      // Re-tag with the original source URL — the tmpdir path inside the
      // repo's resolveSkillDirInClone result isn't useful to callers.
      return err({ kind: "SkillNotFoundInSource", source: input.source, name });
    }

    const { contentHash } = await deps.repo.writeFromDir(name, skillPaths, srcDirRes.value);
    return ok({ contentHash });
  });
}

async function fetchSourceAtVersion(
  deps: InstallDeps,
  source: string,
  version: string,
  dest: string,
): Promise<Result<void, SkillsDomainError>> {
  const host = detectGithubOwnerRepo(source);
  if (host) {
    // Anonymous-first; on 404 retry with sentinel so OneCLI can surface the
    // structured `app_not_connected` / `access_restricted` CTA body.
    let bytes = await deps.github.fetchTarball(host, version, { withAuth: false });
    if (!bytes.ok && bytes.error.kind === "UpstreamGitHubError" && bytes.error.status === 404) {
      bytes = await deps.github.fetchTarball(host, version, { withAuth: true });
    }
    if (!bytes.ok) return bytes;
    await deps.repo.extractTarball(bytes.value, dest, { stripComponents: 1 });
    return ok(undefined);
  }
  return deps.git.fetchAtSha(source, version, dest);
}
