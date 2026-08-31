import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { CoordinationV1Api, V1Lease } from "@kubernetes/client-node";

/*
 * UNIT_BOUNDARY_DESCRIPTION: Elects one api-server replica to run the work that
 * must have a single holder install-wide — the channel workers and the agent
 * watch. The lock is a `coordination.k8s.io` Lease in the agent namespace, the
 * same primitive and namespace the controller elects on, renewed by the holder
 * every third of its duration. A challenger never trusts the `renewTime` it
 * reads, because the clocks of two nodes differ: it takes over only after the
 * Lease has stood unchanged for a full duration measured on its own clock. Two
 * failed campaigns in a row stand the holder down — running the Slack socket
 * without a Lease it can still renew is how one install ends up with two
 * consumers.
 */
export interface LeaderLease {
  isLeader(): boolean;
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
  ttlMs?: number;
  onAcquired: () => Promise<void> | void;
  onLost: () => Promise<void> | void;
  log?: (msg: string) => void;
}): LeaderLease {
  const { leases, namespace, name } = opts;
  const ttlMs = opts.ttlMs ?? 30_000;
  const identity = `${hostname()}-${randomUUID().slice(0, 8)}`;
  const log =
    opts.log ?? ((m: string) => process.stderr.write(`[leader-lease] ${m}\n`));

  let held = false;
  let timer: NodeJS.Timeout | null = null;
  let transition: Promise<void> = Promise.resolve();
  let seen: { holder?: string; renew: string; at: number } | null = null;

  const read = (): Promise<V1Lease | null> =>
    leases.readNamespacedLease({ name, namespace }).catch((err: unknown) => {
      if (isStatus(err, 404)) return null;
      throw err;
    });

  const releaseLease = async () => {
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

  const transitionTo = (next: boolean) => {
    transition = transition.then(async () => {
      if (held === next) return;
      held = next;
      try {
        await (next ? opts.onAcquired() : opts.onLost());
      } catch (err) {
        log(`${next ? "acquire" : "release"} handler failed: ${err}`);
        if (next) {
          held = false;
          try {
            await opts.onLost();
          } catch (lostErr) {
            log(`release handler failed: ${lostErr}`);
          }
          await releaseLease();
        } else {
          try {
            await opts.onLost();
          } catch (retryErr) {
            log(`release handler retry failed: ${retryErr}`);
          }
        }
      }
    });
    return transition;
  };

  async function claim(): Promise<boolean> {
    const spec = () => ({
      holderIdentity: identity,
      leaseDurationSeconds: Math.ceil(ttlMs / 1000),
      renewTime: new Date(),
    });
    try {
      const current = await read();
      if (!current) {
        await leases.createNamespacedLease({
          namespace,
          body: {
            metadata: { name, namespace },
            spec: { ...spec(), acquireTime: new Date() },
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
            acquireTime: mine ? current.spec?.acquireTime : new Date(),
            leaseTransitions: mine
              ? current.spec?.leaseTransitions
              : (current.spec?.leaseTransitions ?? 0) + 1,
          },
        },
      });
      return true;
    } catch (err) {
      if (isStatus(err, 409) || isStatus(err, 404)) return false;
      throw err;
    }
  }

  let campaignFailures = 0;

  async function campaign(): Promise<void> {
    try {
      const won = await claim();
      campaignFailures = 0;
      if (won !== held) log(`lease ${name} ${won ? "acquired" : "lost"}`);
      await transitionTo(won);
    } catch (err) {
      campaignFailures += 1;
      log(`campaign failed: ${err}`);
      if (held && campaignFailures >= 2) {
        await transitionTo(false);
        await releaseLease();
      }
    }
  }

  return {
    isLeader: () => held,

    async start() {
      await campaign();
      timer = setInterval(() => void campaign(), Math.floor(ttlMs / 3));
      timer.unref?.();
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      const wasHeld = held;
      await transitionTo(false);
      if (wasHeld) await releaseLease();
    },
  };
}
