import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Fair use over time. The per-user cgroups divide a
 * busy node evenly between whoever is on it; this leans that division towards
 * whoever has been using it *least*, so an hour of somebody's batch job does
 * not cost the person who shows up wanting one answer the same as it costs the
 * person who has been running builds all morning.
 *
 * It is not a quota and never stops anyone. There is no kernel primitive for
 * "so many CPU-seconds an hour" — cgroup quotas are a rate over a hundred
 * milliseconds, which is a cap rather than a budget — so what this does
 * instead is move each user's weight, and a weight only decides who yields
 * when two people want the same core. On a node nobody else is using, a user
 * throttled to the floor still gets the whole machine, which is the property
 * that makes this a fair-use policy rather than a cliff to fall off.
 *
 * Recent use is an exponential average rather than a window in a ring buffer:
 * one number per user, no history to keep, and it forgets at a rate the
 * half-life states outright. Three minutes is short enough that the tilt is
 * there within a minute or two of somebody arriving — which is the whole point,
 * since nobody waits ten minutes for a turn — and long enough that a finished
 * build is forgotten in well under a quarter of an hour.
 *
 * A user is only judged against the people who were actually competing with
 * them, which below ACTIVE_MILLI means a user between turns rather than one
 * wanting the machine. Dividing the node by everyone who merely has an agent up would charge
 * a user for cores nobody else wanted, and the first tick after somebody
 * arrived would find them already at the floor — handing the newcomer far more
 * than a fair share rather than a fair share tilted their way. So an idle user
 * is not counted in the divisor, and a node with one busy user has nothing to
 * be fair about and is left alone.
 *
 * The loop is self-correcting in the direction that matters. Throttling a heavy
 * user lowers their use, which lowers their average, which lifts the throttle —
 * so the penalty decays on its own and nobody has to be let out of it. It
 * oscillates over minutes by design; the floor is what keeps the trough from
 * being starvation.
 */
const CGROUP_ROOT = "/sys/fs/cgroup";
const USER_PREFIX = "dam-user-";
export const DEFAULT_WEIGHT = 100;
export const MIN_WEIGHT = 10;
const HALF_LIFE_MS = 3 * 60_000;
const ACTIVE_MILLI = 50;

/**
 * UNIT_BOUNDARY_DESCRIPTION: What one user's weight should be, given how much
 * they have been using against what an even split would give them. At or under
 * their share they are left alone; above it their weight falls as the inverse,
 * so twice the share halves it and four times quarters it — which is the same
 * shape as the sharing it feeds, and keeps a heavy user slowed rather than
 * stopped.
 */
export function weightFor(recentMilli: number, fairMilli: number): number {
  if (fairMilli <= 0) return DEFAULT_WEIGHT;
  const ratio = recentMilli / fairMilli;
  if (ratio <= 1) return DEFAULT_WEIGHT;
  return Math.max(MIN_WEIGHT, Math.round(DEFAULT_WEIGHT / ratio));
}

export interface FairShare {
  tick(): Promise<void>;
}

export interface FairShareOpts {
  capacityMilli: () => Promise<number>;
  root?: string;
  now?: () => number;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

export function createFairShare(opts: FairShareOpts): FairShare {
  const root = opts.root ?? CGROUP_ROOT;
  const now = opts.now ?? Date.now;
  const seen = new Map<string, { usec: number; at: number; recent: number }>();

  return {
    async tick() {
      const names = (await readdir(root).catch(() => [])).filter((n) =>
        n.startsWith(USER_PREFIX),
      );
      for (const gone of [...seen.keys()]) {
        if (!names.includes(gone)) seen.delete(gone);
      }
      if (names.length === 0) return;

      const at = now();
      const rates: { name: string; recent: number }[] = [];
      for (const name of names) {
        const stat = await readFile(join(root, name, "cpu.stat"), "utf8").catch(
          () => null,
        );
        const usec = Number(/usage_usec (\d+)/.exec(stat ?? "")?.[1] ?? NaN);
        if (!Number.isFinite(usec)) continue;
        const previous = seen.get(name);
        const elapsed = previous ? at - previous.at : 0;
        let recent = previous?.recent ?? 0;
        if (previous && elapsed > 0) {
          const rate = (usec - previous.usec) / elapsed;
          const decay = Math.pow(0.5, elapsed / HALF_LIFE_MS);
          recent = recent * decay + rate * (1 - decay);
        }
        seen.set(name, { usec, at, recent });
        rates.push({ name, recent });
      }
      if (rates.length === 0) return;

      const competing = rates.filter((r) => r.recent >= ACTIVE_MILLI);
      const fairMilli =
        competing.length > 1
          ? (await opts.capacityMilli()) / competing.length
          : 0;
      for (const { name, recent } of rates) {
        const weight = weightFor(recent, fairMilli);
        await writeFile(join(root, name, "cpu.weight"), String(weight)).catch(
          () => {},
        );
        if (weight !== DEFAULT_WEIGHT) {
          opts.log("fairshare.throttled", {
            cgroup: name,
            weight,
            recentMilli: Math.round(recent),
            fairMilli: Math.round(fairMilli),
          });
        }
      }
    },
  };
}
