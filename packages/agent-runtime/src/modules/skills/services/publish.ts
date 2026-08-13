import type {
  SkillPublishInput,
  SkillPublishResult,
  Result,
  SkillsDomainError,
} from "agent-runtime-api";
import { ok } from "agent-runtime-api";
import { branchTimestamp } from "../domain/branch-timestamp.js";
import { makeSkillSlug, type SkillName } from "../domain/skill-name.js";
import type { SkillPath } from "../domain/skill-path.js";
import type { GitHubRestClient } from "../infrastructure/github-rest-client.js";
import type { LocalSkillRepository } from "../infrastructure/local-skill-repository.js";

export interface PublishDeps {
  github: GitHubRestClient;
  repo: LocalSkillRepository;
  now: () => Date;
}

export async function runPublish(
  deps: PublishDeps,
  name: SkillName,
  skillPaths: SkillPath[],
  input: SkillPublishInput,
): Promise<Result<SkillPublishResult, SkillsDomainError>> {
  const host = { owner: input.owner, repo: input.repo };

  const filesRes = await deps.repo.readLocal(name, skillPaths);
  if (!filesRes.ok) return filesRes;
  const { files } = filesRes.value;

  const repoInfo = await deps.github.getRepo(host);
  if (!repoInfo.ok) return repoInfo;
  const defaultBranch = repoInfo.value.defaultBranch;

  const headRef = await deps.github.getRef(host, defaultBranch);
  if (!headRef.ok) return headRef;
  const headSha = headRef.value.sha;

  const baseDir = input.path && input.path.length > 0 ? input.path : "skills";

  const blobs: { path: string; sha: string }[] = [];
  for (const f of files) {
    const blob = await deps.github.createBlob(
      host,
      f.base64
        ? { content: f.content, encoding: "base64" }
        : { content: f.content, encoding: "utf-8" },
    );
    if (!blob.ok) return blob;
    blobs.push({
      path: `${baseDir}/${name}/${f.relPath}`,
      sha: blob.value.sha,
    });
  }

  const tree = await deps.github.createTree(host, {
    base_tree: headSha,
    tree: blobs.map((b) => ({
      path: b.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: b.sha,
    })),
  });
  if (!tree.ok) return tree;

  const commit = await deps.github.createCommit(host, {
    message: `Add ${name} skill`,
    tree: tree.value.sha,
    parents: [headSha],
    author: {
      name: "Platform",
      email: "platform-publish@users.noreply.github.com",
    },
  });
  if (!commit.ok) return commit;

  const slug = makeSkillSlug(name);
  const refName = slug.ok ? slug.value : "skill";
  const branch = `platform/publish-${refName}-${branchTimestamp(deps.now())}`;
  const refRes = await deps.github.createRef(host, {
    ref: `refs/heads/${branch}`,
    sha: commit.value.sha,
  });
  if (!refRes.ok) return refRes;

  const pr = await deps.github.createPullRequest(host, {
    title: input.title,
    body: input.body,
    head: branch,
    base: defaultBranch,
  });
  if (!pr.ok) return pr;

  return ok({ prUrl: pr.value.htmlUrl, branch });
}
