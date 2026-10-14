import type {
  SkillInstallInput,
  SkillInstallResult,
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
import { fetchGithubPath, isGithubNotFound } from "./fetch-github-path.js";
import type { GitProtocolClient } from "../../git/protocol-client.js";
import {
  subPathEscapes,
  type LocalSkillRepository,
} from "../infrastructure/local-skill-repository.js";

export interface InstallDeps {
  github: GitHubRestClient;
  git: GitProtocolClient;
  repo: LocalSkillRepository;
}

export async function runInstall(
  deps: InstallDeps,
  name: SkillName,
  skillPaths: SkillPath[],
  input: SkillInstallInput,
): Promise<Result<SkillInstallResult, SkillsDomainError>> {
  return deps.repo.withTempDir("platform-skill-", async (tmp) => {
    const fetched = await fetchSourceAtVersion(deps, input, name, tmp);
    if (!fetched.ok) return fetched;

    const srcDirRes = await deps.repo.resolveSkillDirInClone(
      tmp,
      name,
      input.path,
    );
    if (!srcDirRes.ok) {
      return err({
        kind: "SkillNotFoundInSource",
        source: input.sourceUrl,
        name,
      });
    }

    const { contentHash } = await deps.repo.writeFromDir(
      name,
      skillPaths,
      srcDirRes.value,
    );
    return ok({ contentHash });
  });
}

async function fetchSourceAtVersion(
  deps: InstallDeps,
  input: SkillInstallInput,
  name: SkillName,
  dest: string,
): Promise<Result<void, SkillsDomainError>> {
  const { sourceUrl: source, version, path: subPath } = input;
  const host = detectGithubOwnerRepo(source);
  if (input.fetch === "directory" && host && subPath) {
    if (subPathEscapes(subPath)) return ok(undefined);
    const byDirectory = await fetchGithubPath(
      deps,
      host,
      version,
      subPath,
      dest,
      name,
    );
    return isGithubNotFound(byDirectory) ? ok(undefined) : byDirectory;
  }
  if (host) {
    let bytes = await deps.github.fetchTarball(host, version, {
      withAuth: false,
    });
    if (
      !bytes.ok &&
      bytes.error.kind === "UpstreamGitHubError" &&
      bytes.error.status === 404
    ) {
      bytes = await deps.github.fetchTarball(host, version, { withAuth: true });
    }
    if (!bytes.ok) return bytes;
    await deps.repo.extractTarball(bytes.value, dest, { stripComponents: 1 });
    return ok(undefined);
  }
  return deps.git.fetchAtSha(source, version, dest);
}
