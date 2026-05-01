import type {
  PublishSkillInput,
  PublishSkillResult,
  Result,
  SkillsDomainError,
} from "agent-runtime-api";
import { ok } from "agent-runtime-api";
import { branchTimestamp } from "../domain/branch-timestamp.js";
import type { SkillName } from "../domain/skill-name.js";
import type { SkillPath } from "../domain/skill-path.js";
import type { GitHubRestClient } from "../infrastructure/github-rest-client.js";
import type { LocalSkillRepository } from "../infrastructure/local-skill-repository.js";

export interface PublishDeps {
  github: GitHubRestClient;
  repo: LocalSkillRepository;
  /** Wall-clock provider — passed in so the domain branch-timestamp helper
   *  stays pure and tests can pin time. */
  now: () => Date;
}

/**
 * Publish a local skill to GitHub as a new branch + PR. Executes entirely
 * via the REST API through OneCLI's MITM — no git subprocess, no working
 * copy on disk. Multi-step REST sequencing lives here (not in the port);
 * the port stays a thin typed wrapper around api.github.com.
 *
 * Requires this pod to run with `GH_TOKEN=humr:sentinel` + `HTTPS_PROXY`
 * pre-wired by the controller (always true in Humr), OneCLI's
 * `GITHUB_CLIENT_ID/SECRET` configured, the user Connected, and this agent
 * granted access. Failures on any of those surface as a 401/403 from
 * OneCLI's gateway with a structured error body the contract relays.
 */
export async function runPublish(
  deps: PublishDeps,
  name: SkillName,
  skillPaths: SkillPath[],
  input: PublishSkillInput,
): Promise<Result<PublishSkillResult, SkillsDomainError>> {
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

  // 1. Blob per file.
  const blobs: { path: string; sha: string }[] = [];
  for (const f of files) {
    const blob = await deps.github.createBlob(
      host,
      f.base64
        ? { content: f.content, encoding: "base64" }
        : { content: f.content, encoding: "utf-8" },
    );
    if (!blob.ok) return blob;
    blobs.push({ path: `skills/${name}/${f.relPath}`, sha: blob.value.sha });
  }

  // 2. Tree referencing the blobs, parented on the default-branch HEAD tree.
  const tree = await deps.github.createTree(host, {
    base_tree: headSha,
    tree: blobs.map((b) => ({ path: b.path, mode: "100644" as const, type: "blob" as const, sha: b.sha })),
  });
  if (!tree.ok) return tree;

  // 3. Commit pointing at the tree.
  const commit = await deps.github.createCommit(host, {
    message: `Add ${name} skill\n\nPublished from Humr.`,
    tree: tree.value.sha,
    parents: [headSha],
    author: { name: "Humr", email: "humr-publish@users.noreply.github.com" },
  });
  if (!commit.ok) return commit;

  // 4. Create the branch ref.
  const branch = `humr/publish-${name}-${branchTimestamp(deps.now())}`;
  const refRes = await deps.github.createRef(host, {
    ref: `refs/heads/${branch}`,
    sha: commit.value.sha,
  });
  if (!refRes.ok) return refRes;

  // 5. Open the PR.
  const pr = await deps.github.createPullRequest(host, {
    title: input.title,
    body: input.body,
    head: branch,
    base: defaultBranch,
  });
  if (!pr.ok) return pr;

  return ok({ prUrl: pr.value.htmlUrl, branch });
}
