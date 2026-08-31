import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { V1MicroTime } from "@kubernetes/client-node";
import type { CoordinationV1Api, V1Lease } from "@kubernetes/client-node";

/*
 * UNIT_BOUNDARY_DESCRIPTION: Elects one api-server replica to run every piece
 * of work that admits a single holder install-wide — the channel workers and
 * the agent watch — on one `coordination.k8s.io` Lease in the agent namespace,
 * the same primitive and namespace the controller elects on. One Lease, one
 * campaign, several roles: two elections could disagree, and an operator asking
 * which pod is leading should get one answer. The holder renews every third of
 * the duration. A challenger never trusts the `renewTime` it reads, because the
 * clocks of two nodes differ: it takes over only after the Lease has stood
 * unchanged for a full duration measured on its own clock. Two failed campaigns
 * in a row stand the holder down, since serving without a Lease it can renew is
 * how one install ends up with two Slack consumers. `stop()` cannot be outrun by
 * a campaign still awaiting the API server: it moves a generation the campaign
 * re-reads after each await, and waits for in-flight claims before deleting the
 * Lease one of them may just have written. Handler failure is a signal, not a
 * log line. A role that fails to start is rolled back and retried on later
 * ticks while its siblings keep serving, because a role failing for its own
 * reasons is no reason to drop the ones that work; only when no role at all can
 * start does the replica release the Lease and back off, so a broken replica
 * cannot squat on it. A role that fails to stop twice keeps the Lease: work this
 * replica could not prove it stopped must never be handed to another.
 */
export interface LeaderRole {
  name: string;
  onAcquired: () => Promise<void> | void;
  onLost: () => Promise<void> | void;
}

export interface LeaderLease {
  isLeader(): boolean;
  isRunning(role: string): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const isStatus = (err: unknown, code: number) =>
  err instanceof Error &&
  "code" in err &&
  (err as { code: number }).code === code;

export function createLeaderLease(opts: {
  leases: CoordinationV1Api;
  namespace: string;
  name: string;
  roles: LeaderRole[];
  ttlMs?: number;
  log?: (msg: string) => void;
}): LeaderLease {
  const { leases, namespace, name, roles } = opts;
  const ttlMs = opts.ttlMs ?? 30_000;
  const identity = `${hostname()}-${randomUUID().slice(0, 8)}`;
  const log =
    opts.log ?? ((m: string) => process.stderr.write(`[leader-lease] ${m}\n`));

  let held = false;
  let generation = 0;
  let timer: NodeJS.Timeout | null = null;
  let transition: Promise<void> = Promise.resolve();
  let seen: { holder?: string; renew: string; at: number } | null = null;
  let acquireFailures = 0;
  let backoffUntil = 0;
  let releaseFailed = false;
  const running = new Set<string>();

  const read = (): Promise<V1Lease | null> =>
    leases.readNamespacedLease({ name, namespace }).catch((err: unknown) => {
      if (isStatus(err, 404)) return null;
      throw err;
    });

  const releaseLease = async () => {
    if (releaseFailed) {
      log(
        `ERROR: keeping lease ${name}: a role failed to stop twice, so this replica may still be serving`,
      );
      return;
    }
    const current = await read().catch(() => null);
    if (current?.spec?.holderIdentity !== identity) return;
    await leases
      .deleteNamespacedLease({
        name,
        namespace,
        body: {
          preconditions: {
            resourceVersion: current.metadata?.resourceVersion,
            uid: current.metadata?.uid,
          },
        },
      })
      .catch(() => {});
  };

  const stopRole = async (role: LeaderRole) => {
    try {
      await role.onLost();
      running.delete(role.name);
    } catch (err) {
      log(`role ${role.name} failed to stop: ${err}`);
      try {
        await role.onLost();
        running.delete(role.name);
      } catch (retryErr) {
        log(`role ${role.name} failed to stop on retry: ${retryErr}`);
        releaseFailed = true;
      }
    }
  };

  const startRoles = async (): Promise<void> => {
    for (const role of roles) {
      if (running.has(role.name)) continue;
      try {
        await role.onAcquired();
        running.add(role.name);
      } catch (err) {
        log(`role ${role.name} failed to start: ${err}`);
        await stopRole(role);
      }
    }
    if (running.size > 0) {
      acquireFailures = 0;
      return;
    }
    held = false;
    acquireFailures += 1;
    backoffUntil = Date.now() + ttlMs * Math.min(acquireFailures, 4);
    log(
      `no role could start; standing down for ${backoffUntil - Date.now()}ms`,
    );
    await releaseLease();
  };

  const transitionTo = (next: boolean) => {
    transition = transition.then(async () => {
      if (held === next) {
        if (held) await startRoles();
        return;
      }
      held = next;
      if (next) await startRoles();
      else
        for (const role of roles)
          if (running.has(role.name)) await stopRole(role);
    });
    return transition;
  };

  async function claim(recreate = true): Promise<boolean> {
    const spec = () => ({
      holderIdentity: identity,
      leaseDurationSeconds: Math.ceil(ttlMs / 1000),
      renewTime: new V1MicroTime(),
    });
    try {
      const current = await read();
      if (!current) {
        await leases.createNamespacedLease({
          namespace,
          body: {
            metadata: { name, namespace },
            spec: { ...spec(), acquireTime: new V1MicroTime() },
          },
        });
        return true;
      }
      const mine = current.spec?.holderIdentity === identity;
      if (!mine) {
        const renew = String(current.spec?.renewTime ?? "");
        const observed =
          seen &&
          seen.holder === current.spec?.holderIdentity &&
          seen.renew === renew
            ? seen
            : { holder: current.spec?.holderIdentity, renew, at: Date.now() };
        seen = observed;
        if (Date.now() - observed.at < ttlMs) return false;
      }
      await leases.replaceNamespacedLease({
        name,
        namespace,
        body: {
          ...current,
          spec: {
            ...spec(),
            acquireTime: new V1MicroTime(
              (mine && current.spec?.acquireTime) || Date.now(),
            ),
            leaseTransitions: mine
              ? current.spec?.leaseTransitions
              : (current.spec?.leaseTransitions ?? 0) + 1,
          },
        },
      });
      return true;
    } catch (err) {
      if (isStatus(err, 404) && recreate) return claim(false);
      if (isStatus(err, 409) || isStatus(err, 404)) return false;
      throw err;
    }
  }

  let campaignFailures = 0;
  const inFlight = new Set<Promise<boolean>>();

  async function campaign(generationAtStart: number): Promise<void> {
    if (Date.now() < backoffUntil) return;
    const claiming = claim();
    inFlight.add(claiming);
    try {
      const won = await claiming;
      if (generationAtStart !== generation) return;
      campaignFailures = 0;
      if (won !== held) log(`lease ${name} ${won ? "acquired" : "lost"}`);
      await transitionTo(won);
    } catch (err) {
      if (generationAtStart !== generation) return;
      campaignFailures += 1;
      log(`campaign failed: ${err}`);
      if (held && campaignFailures >= 2) {
        await transitionTo(false);
        await releaseLease();
      }
    } finally {
      inFlight.delete(claiming);
    }
  }

  return {
    isLeader: () => held,
    isRunning: (role: string) => held && running.has(role),

    async start() {
      const generationAtStart = generation;
      await campaign(generationAtStart);
      if (generationAtStart !== generation) return;
      timer = setInterval(
        () => void campaign(generationAtStart),
        Math.floor(ttlMs / 3),
      );
      timer.unref?.();
    },

    async stop() {
      generation += 1;
      if (timer) clearInterval(timer);
      timer = null;
      await Promise.allSettled([...inFlight]);
      await transitionTo(false);
      await releaseLease();
    },
  };
}
