// TEST_OVERVIEW: the per-user cgroup that makes CPU a contest between people rather than between agents. What it has to get right is unglamorous — a directory per user, the controllers delegated so the sandboxes inside it are still limited, and empty ones cleared away — but getting the delegation wrong produces sandboxes with no CPU control at all, which looks like everything working until a node is busy.
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createUserCgroups,
  userCgroupOf,
} from "../../modules/sandboxes/infrastructure/user-cgroup.js";

describe("naming a user's cgroup", () => {
  it("keeps a subject id readable", () => {
    expect(userCgroupOf("e69b2382-90f5-45ae-94b8-ab8e745278dc")).toBe(
      "dam-user-e69b2382-90f5-45ae-94b8-ab8e745278dc",
    );
  });

  // TEST_SCENARIO: a subject id from an identity provider that does not issue UUIDs. It becomes a directory name, so anything that could walk out of the cgroup root has to stop being a path.
  it("refuses to let a subject id become a path", () => {
    expect(userCgroupOf("../../escape")).toBe("dam-user-______escape");
    expect(userCgroupOf("a/b")).toBe("dam-user-a_b");
  });
});

describe("keeping the tree", () => {
  it("creates a user's group and delegates the controllers", async () => {
    const root = mkdtempSync(join(tmpdir(), "cg-tree-"));
    const cgroups = createUserCgroups(root);
    const name = await cgroups.ensure("sub-1");
    expect(readdirSync(root)).toContain(name);
    expect(readdirSync(join(root, name))).toContain("cgroup.subtree_control");
  });

  // TEST_SCENARIO: a user whose last agent has gone. Their group is left behind, and an install accumulates one per user who has ever run anything. The groups here are made by hand rather than by ensure, because on a real cgroup filesystem the control files inside one do not stop it being removed and on an ordinary directory they would.
  it("clears away a user's group once nothing is in it", async () => {
    const root = mkdtempSync(join(tmpdir(), "cg-tree-"));
    mkdirSync(join(root, "dam-user-gone"));
    mkdirSync(join(root, "dam-user-busy", "dam-agent-1"), { recursive: true });
    mkdirSync(join(root, "system.slice"));
    await createUserCgroups(root).prune();
    const left = readdirSync(root);
    expect(left).toContain("dam-user-busy");
    expect(left).toContain("system.slice");
    expect(left).not.toContain("dam-user-gone");
  });
});
