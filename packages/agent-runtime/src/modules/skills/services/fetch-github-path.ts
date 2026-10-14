import * as path from "node:path";
import type { Result, SkillsDomainError } from "agent-runtime-api";
import { ok } from "agent-runtime-api";
import type {
  DetectedOwnerRepo,
  GitHubRestClient,
  GithubFetchOpts,
  SubtreeFile,
} from "../infrastructure/github-rest-client.js";
import type { LocalSkillRepository } from "../infrastructure/local-skill-repository.js";

export function isGithubNotFound(
  res: Result<unknown, SkillsDomainError>,
): boolean {
  return (
    !res.ok &&
    res.error.kind === "UpstreamGitHubError" &&
    res.error.status === 404
  );
}

async function anonymousFirst<T>(
  call: (opts: GithubFetchOpts) => Promise<Result<T, SkillsDomainError>>,
): Promise<Result<T, SkillsDomainError>> {
  const anonymous = await call({ withAuth: false });
  return isGithubNotFound(anonymous) ? call({ withAuth: true }) : anonymous;
}

export async function fetchGithubPath(
  deps: { github: GitHubRestClient; repo: LocalSkillRepository },
  host: DetectedOwnerRepo,
  ref: string,
  subPath: string,
  dest: string,
  skill?: string,
): Promise<Result<void, SkillsDomainError>> {
  const { github } = deps;
  const dir = path.posix.normalize(subPath).replace(/\/+$/, "");
  const write = async (files: Result<SubtreeFile[], SkillsDomainError>) => {
    if (!files.ok) return files;
    await deps.repo.writeFiles(dest, files.value);
    return ok(undefined);
  };

  if (skill) {
    const direct = await anonymousFirst((o) =>
      github.fetchSubtree(host, ref, path.posix.join(dir, skill), o),
    );
    if (!isGithubNotFound(direct)) return write(direct);
  }
  const real = await anonymousFirst((o) =>
    github.resolveDir(host, ref, dir, o),
  );
  if (!real.ok) return real;
  const realDir = real.value.path;
  if (skill && realDir !== dir) {
    const viaLink = await anonymousFirst((o) =>
      github.fetchSubtree(
        host,
        ref,
        path.posix.join(realDir, skill),
        o,
        path.posix.join(dir, skill),
      ),
    );
    if (!isGithubNotFound(viaLink)) return write(viaLink);
  }
  if (skill && !real.value.hasManifest) return ok(undefined);
  return write(
    await anonymousFirst((o) =>
      github.fetchSubtree(host, ref, realDir, o, dir),
    ),
  );
}
