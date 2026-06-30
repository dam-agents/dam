import { describe, expect, it } from "vitest";
import { ok } from "agent-runtime-api";
import type { SkillPublishInput } from "agent-runtime-api";
import { runPublish } from "../../modules/skills/services/publish.js";
import type { PublishDeps } from "../../modules/skills/services/publish.js";
import type { GitHubRestClient } from "../../modules/skills/infrastructure/github-rest-client.js";
import type { LocalSkillRepository } from "../../modules/skills/infrastructure/local-skill-repository.js";
import type { SkillName } from "../../modules/skills/domain/skill-name.js";
import type { SkillPath } from "../../modules/skills/domain/skill-path.js";

/** Capture the tree paths runPublish asks GitHub to create. */
function makeDeps(): { deps: PublishDeps; treePaths: () => string[] } {
  let captured: string[] = [];
  const github: GitHubRestClient = {
    getRepo: async () => ok({ defaultBranch: "main" }),
    getRef: async () => ok({ sha: "head-sha" }),
    getCommitHead: async () => ok({ sha: "head-sha" }),
    fetchTarball: async () => ok(new Uint8Array()),
    createBlob: async () => ok({ sha: "blob-sha" }),
    createTree: async (_host, body) => {
      captured = body.tree.map((e) => e.path);
      return ok({ sha: "tree-sha" });
    },
    createCommit: async () => ok({ sha: "commit-sha" }),
    createRef: async () => ok({}),
    createPullRequest: async () => ok({ htmlUrl: "https://example/pr/1" }),
  };
  const repo = {
    readLocal: async () =>
      ok({ files: [{ relPath: "SKILL.md", content: "# hi" }] }),
  } as unknown as LocalSkillRepository;
  return {
    deps: { github, repo, now: () => new Date(0) },
    treePaths: () => captured,
  };
}

const input = (path?: string): SkillPublishInput => ({
  name: "my-skill",
  owner: "acme",
  repo: "skills-repo",
  title: "Add my-skill",
  body: "",
  ...(path !== undefined ? { path } : {}),
});

describe("runPublish blob paths", () => {
  it("defaults to skills/ when the source has no configured path", async () => {
    const { deps, treePaths } = makeDeps();
    const res = await runPublish(
      deps,
      "my-skill" as SkillName,
      ["/home/.claude/skills" as SkillPath],
      input(),
    );
    expect(res.ok).toBe(true);
    expect(treePaths()).toEqual(["skills/my-skill/SKILL.md"]);
  });

  it("publishes into the source's configured subdir", async () => {
    const { deps, treePaths } = makeDeps();
    const res = await runPublish(
      deps,
      "my-skill" as SkillName,
      ["/home/.claude/skills" as SkillPath],
      input(".claude/skills"),
    );
    expect(res.ok).toBe(true);
    expect(treePaths()).toEqual([".claude/skills/my-skill/SKILL.md"]);
  });
});
