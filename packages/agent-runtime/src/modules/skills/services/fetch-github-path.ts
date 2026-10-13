import * as path from "node:path";
import type { Result, SkillsDomainError } from "agent-runtime-api";
import { ok } from "agent-runtime-api";
import type {
  DetectedOwnerRepo,
  GitHubRestClient,
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

export async function fetchGithubPath(
  deps: { github: GitHubRestClient; repo: LocalSkillRepository },
  host: DetectedOwnerRepo,
  ref: string,
  subPath: string,
  dest: string,
): Promise<Result<void, SkillsDomainError>> {
  const dir = path.posix.normalize(subPath).replace(/\/+$/, "");
  let files = await deps.github.fetchSubtree(host, ref, dir, {
    withAuth: false,
  });
  if (isGithubNotFound(files)) {
    files = await deps.github.fetchSubtree(host, ref, dir, { withAuth: true });
  }
  if (!files.ok) return files;
  await deps.repo.writeFiles(dest, files.value);
  return ok(undefined);
}
