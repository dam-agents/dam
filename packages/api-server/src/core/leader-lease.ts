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
 * log line. The roles start and stop together, all or none: a replica that
 * cannot bring up everything the Lease stands for rolls back what did start,
 * releases the Lease and backs off for whole durations, so it cannot squat on
 * the election while unable to serve. Roles start concurrently, so one that
 * hangs cannot keep its siblings from starting or a stand-down from running. A
 * role that fails to stop twice is the one thing that keeps the Lease: work
 * this replica could not prove it stopped must never be handed to another. Such
 * a role is recorded as stopped rather than running, so a later start can bring
 * it back, and the Lease becomes deletable again once some stop of it succeeds.
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
  const running = new Set<string>();
  const stopFailed = new Set<string>();

  const read = (): Promise<V1Lease | null> =>
    leases.readNamespacedLease({ name, namespace }).catch((err: unknown) => {
      if (isStatus(err, 404)) return null;
      throw err;
    });

  const releaseLease = async () => {
    if (stopFailed.size > 0) {
      log(
        `ERROR: keeping lease ${name}: ${[...stopFailed].join(", ")} failed to stop twice, so this replica may still be serving`,
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
    running.delete(role.name);
    try {
      await role.onLost();
      stopFailed.delete(role.name);
    } catch (err) {
      log(`role ${role.name} failed to stop: ${err}`);
      try {
        await role.onLost();
        stopFailed.delete(role.name);
      } catch (retryErr) {
        log(`role ${role.name} failed to stop on retry: ${retryErr}`);
        stopFailed.add(role.name);
      }
    }
  };

  const stopAll = () =>
    Promise.all(roles.filter((r) => running.has(r.name)).map(stopRole));

  const startAll = async (): Promise<boolean> => {
    const started = await Promise.allSettled(
      roles.map(async (role) => {
        await role.onAcquired();
        running.add(role.name);
      }),
    );
    const failed = started.flatMap((r, i) =>
      r.status === "rejected" ? [`${roles[i]!.name}: ${r.reason}`] : [],
    );
    if (failed.length === 0) {
      acquireFailures = 0;
      return true;
    }
    log(`roles failed to start (${failed.join("; ")}); standing down`);
    await Promise.all(roles.map(stopRole));
    acquireFailures += 1;
    backoffUntil = Date.now() + ttlMs * Math.min(acquireFailures, 4);
    return false;
  };

  const transitionTo = (next: boolean) => {
    transition = transition.then(async () => {
      if (held === next) return;
      held = next;
      if (!next) {
        await stopAll();
        return;
      }
      if (await startAll()) return;
      held = false;
      await releaseLease();
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
