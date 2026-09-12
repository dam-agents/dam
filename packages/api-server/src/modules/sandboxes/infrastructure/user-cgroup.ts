import { mkdir, readdir, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One cgroup per user, with that user's sandboxes
 * inside it, so that CPU is divided between people rather than between agents.
 *
 * Weights compete between siblings. With every sandbox at the root, a user
 * running ten agents takes ten shares and a user running one takes one — the
 * platform quietly rewards whoever leaves the most running. Nesting them makes
 * the top-level contest one per user, and the agents inside a user's group
 * divide only what that user won, which is the fairness people actually expect
 * and the reason a per-user ceiling exists at all.
 *
 * This is per node, and deliberately so. A user's agents do not have to live on
 * one node for it to work: contention is a property of a machine, so dividing
 * each machine between the people using *that* machine is the whole of the
 * problem. A user with agents on two nodes gets a share of each, and the second
 * node's share costs the first node's users nothing.
 *
 * A group's children only get cpu and memory files of their own if the group
 * delegates those controllers, which is why creating one is two steps rather
 * than a mkdir.
 *
 * Only CPU is shared this way. Memory is promised per agent and subtracted from
 * the node at placement, so a second ceiling here would either duplicate that
 * or contradict it — and a per-node copy of an install-wide ceiling would let a
 * user have the whole of it on every node at once.
 */
const ROOT = "/sys/fs/cgroup";

export const userCgroupOf = (owner: string) =>
  `dam-user-${owner.replace(/[^A-Za-z0-9_-]/g, "_")}`;

export interface UserCgroups {
  ensure(owner: string): Promise<string>;
  prune(): Promise<void>;
}

export function createUserCgroups(root = ROOT): UserCgroups {
  return {
    async ensure(owner) {
      const name = userCgroupOf(owner);
      await mkdir(join(root, name), { recursive: true });
      await writeFile(
        join(root, name, "cgroup.subtree_control"),
        "+cpu +memory",
      ).catch(() => {});
      return name;
    },

    async prune() {
      for (const entry of await readdir(root).catch(() => [])) {
        if (!entry.startsWith("dam-user-")) continue;
        const children = await readdir(join(root, entry)).catch(() => []);
        if (children.some((c) => c.startsWith("dam-"))) continue;
        await rmdir(join(root, entry)).catch(() => {});
      }
    },
  };
}
