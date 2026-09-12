import { readFile } from "node:fs/promises";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What an agent is actually using on the node, as
 * opposed to what it was promised. Nobody picks an agent's size any more, so
 * the only honest thing to show a user asking where their compute went is
 * measurement: which agents are heavy, right now, in the units the node
 * charges them in.
 *
 * It reads the sandbox's own cgroup, which is the same accounting the kernel
 * enforces the memory ceiling with, so the number on the screen and the number
 * that gets an agent killed are the same number. That includes the sentry
 * itself rather than only the processes inside it — the sentry is what the
 * agent costs the node, and an accounting that excluded it would understate
 * every agent by the same tens of megabytes.
 *
 * CPU is a rate, so it needs two readings and the time between them. The first
 * call for an agent can only start the clock and reports nothing; every call
 * after it reports the average over the gap. That suits a caller that samples
 * on a timer and would be wrong for one that asks twice in a second, which is
 * why the gap is taken from the clock rather than assumed.
 *
 * The owner's share weight comes back with it, read from the group the sandbox
 * sits in. The node's fair-use policy writes that file; reading it here rather
 * than asking the policy means the figure a user is shown is the one the kernel
 * is actually dividing by, not a second copy of it that could disagree.
 *
 * A missing cgroup is a hibernated or half-built agent and not an error: an
 * agent that is not running is using nothing, which is the answer.
 */
export interface AgentUsage {
  memoryBytes: number;
  cpuMilli: number | null;
  shareWeight: number | null;
}

export interface UsageReader {
  read(agentId: string, parent?: string): Promise<AgentUsage | null>;
  forget(agentId: string): void;
}

const ROOT = "/sys/fs/cgroup";
const MIN_SAMPLE_MS = 1_000;

export function createUsageReader(
  root = ROOT,
  now: () => number = Date.now,
): UsageReader {
  const last = new Map<string, { usec: number; at: number }>();

  return {
    async read(agentId, parent) {
      const dir = parent
        ? `${root}/${parent}/dam-${agentId}`
        : `${root}/dam-${agentId}`;
      const [current, stat, weight] = await Promise.all([
        readFile(`${dir}/memory.current`, "utf8").catch(() => null),
        readFile(`${dir}/cpu.stat`, "utf8").catch(() => null),
        parent
          ? readFile(`${root}/${parent}/cpu.weight`, "utf8").catch(() => null)
          : null,
      ]);
      if (current === null || stat === null) {
        last.delete(agentId);
        return null;
      }
      const usec = Number(/usage_usec (\d+)/.exec(stat)?.[1] ?? NaN);
      const at = now();
      const previous = last.get(agentId);
      if (Number.isFinite(usec)) last.set(agentId, { usec, at });

      const elapsed = previous ? at - previous.at : 0;
      const cpuMilli =
        previous && Number.isFinite(usec) && elapsed >= MIN_SAMPLE_MS
          ? Math.max(0, Math.round((usec - previous.usec) / elapsed))
          : null;
      const share = weight === null ? NaN : Number(weight.trim());
      return {
        memoryBytes: Number(current.trim()) || 0,
        cpuMilli,
        shareWeight: Number.isFinite(share) ? share : null,
      };
    },

    forget(agentId) {
      last.delete(agentId);
    },
  };
}
