import { describe, it, expect, vi } from "vitest";
import type { CoordinationV1Api, V1Lease } from "@kubernetes/client-node";
import { createLeaderLease } from "../../core/leader-lease.js";

type FakeLeaseApi = CoordinationV1Api & { store: Map<string, V1Lease> };

const status = (code: number) =>
  Object.assign(new Error(`status ${code}`), { code });

function fakeLeaseApi(): FakeLeaseApi {
  const store = new Map<string, V1Lease>();
  let revision = 0;
  const persist = (name: string, body: V1Lease) => {
    for (const stamp of [body.spec?.renewTime, body.spec?.acquireTime])
      if (stamp && !/\.\d{6}Z$/.test(stamp.toISOString())) throw status(400);
    const stored = {
      ...body,
      metadata: { ...body.metadata, resourceVersion: String(++revision) },
    };
    store.set(name, stored);
    return structuredClone(stored);
  };
  return {
    store,
    async readNamespacedLease({ name }: { name: string }) {
      const lease = store.get(name);
      if (!lease) throw status(404);
      return structuredClone(lease);
    },
    async createNamespacedLease({ body }: { body: V1Lease }) {
      const name = body.metadata?.name ?? "";
      if (store.has(name)) throw status(409);
      return persist(name, body);
    },
    async replaceNamespacedLease({
      name,
      body,
    }: {
      name: string;
      body: V1Lease;
    }) {
      const current = store.get(name);
      if (!current) throw status(404);
      if (current.metadata?.resourceVersion !== body.metadata?.resourceVersion)
        throw status(409);
      return persist(name, body);
    },
    async deleteNamespacedLease({
      name,
      body,
    }: {
      name: string;
      body?: { preconditions?: { resourceVersion?: string } };
    }) {
      const current = store.get(name);
      if (!current) throw status(404);
      const expected = body?.preconditions?.resourceVersion;
      if (expected && current.metadata?.resourceVersion !== expected)
        throw status(409);
      store.delete(name);
    },
  } as unknown as FakeLeaseApi;
}

const LEASE = "platform-apiserver";

const makeLease = (
  leaseApi: FakeLeaseApi,
  handlers: {
    onAcquired: () => Promise<void> | void;
    onLost: () => Promise<void> | void;
  },
) =>
  createLeaderLease({
    leases: leaseApi,
    namespace: "platform-agents",
    name: LEASE,
    roles: [{ name: "channels", ...handlers }],
    log: () => {},
  });

/*
 * TEST_OVERVIEW: Leader election for the api-server work that must have one
 * holder install-wide. The lock is a `coordination.k8s.io` Lease, so the fake
 * API here enforces what a real API server enforces: `resourceVersion`
 * compare-and-swap on every write, 404 on a missing Lease, 409 on a lost race,
 * and MicroTime stamps carrying microsecond precision — a Lease whose
 * `renewTime` has only millisecond digits is rejected with a 400, which is how
 * a campaign that never wins looks from inside the pod.
 */
describe("leader lease", () => {
  it("elects exactly one holder among replicas campaigning at once", async () => {
    const leaseApi = fakeLeaseApi();
    const acquired: string[] = [];
    const leases = ["a", "b", "c"].map((name) =>
      makeLease(leaseApi, {
        onAcquired: () => void acquired.push(name),
        onLost: () => {},
      }),
    );

    await Promise.all(leases.map((l) => l.start()));

    expect(acquired).toEqual(["a"]);
    expect(leases.filter((l) => l.isLeader())).toHaveLength(1);

    await Promise.all(leases.map((l) => l.stop()));
  });

  it("hands the lease to another replica when the holder stops", async () => {
    const leaseApi = fakeLeaseApi();
    const events: string[] = [];
    const make = (name: string) =>
      makeLease(leaseApi, {
        onAcquired: () => void events.push(`+${name}`),
        onLost: () => void events.push(`-${name}`),
      });

    const first = make("a");
    const second = make("b");
    await first.start();
    await second.start();
    expect(events).toEqual(["+a"]);

    await first.stop();
    expect(leaseApi.store.has(LEASE)).toBe(false);

    await second.start();
    expect(events).toEqual(["+a", "-a", "+b"]);

    await second.stop();
  });

  // TEST_SCENARIO: a challenger must not steal a Lease whose holder is still renewing it, and the wait it applies is measured on its own clock — the holder's renewTime comes from another node, whose clock differs.
  it("takes over a foreign lease only after a full duration of no renewal", async () => {
    vi.useFakeTimers();
    try {
      const leaseApi = fakeLeaseApi();
      leaseApi.store.set(LEASE, {
        metadata: { name: LEASE, resourceVersion: "1" },
        spec: {
          holderIdentity: "a-dead-replica",
          leaseDurationSeconds: 30,
          renewTime: new Date(),
        },
      });
      const lease = makeLease(leaseApi, {
        onAcquired: () => {},
        onLost: () => {},
      });

      await lease.start();
      expect(lease.isLeader()).toBe(false);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(lease.isLeader()).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(lease.isLeader()).toBe(true);
      expect(leaseApi.store.get(LEASE)?.spec?.leaseTransitions).toBe(1);

      await lease.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the lease when onAcquired fails, so another replica can win", async () => {
    const leaseApi = fakeLeaseApi();
    const events: string[] = [];
    const broken = makeLease(leaseApi, {
      onAcquired: () => {
        events.push("+a");
        throw new Error("slack gateway failed to connect");
      },
      onLost: () => void events.push("-a"),
    });
    const healthy = makeLease(leaseApi, {
      onAcquired: () => void events.push("+b"),
      onLost: () => void events.push("-b"),
    });

    await broken.start();
    expect(broken.isLeader()).toBe(false);
    expect(leaseApi.store.has(LEASE)).toBe(false);

    await healthy.start();
    expect(healthy.isLeader()).toBe(true);
    expect(events).toEqual(["+a", "-a", "+b"]);

    await broken.stop();
    await healthy.stop();
  });

  // TEST_SCENARIO: one transient renew error must not cost the install a holder; the second stands down and deletes the Lease so takeover beats the duration.
  it("tolerates one renew blip, stands down and releases on the second", async () => {
    vi.useFakeTimers();
    try {
      const leaseApi = fakeLeaseApi();
      const lease = makeLease(leaseApi, {
        onAcquired: () => {},
        onLost: () => {},
      });
      await lease.start();
      expect(lease.isLeader()).toBe(true);

      const realReplace = leaseApi.replaceNamespacedLease.bind(leaseApi);
      leaseApi.replaceNamespacedLease = (() =>
        Promise.reject(
          new Error("ETIMEDOUT"),
        )) as CoordinationV1Api["replaceNamespacedLease"];

      await vi.advanceTimersByTimeAsync(10_000);
      expect(lease.isLeader()).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(lease.isLeader()).toBe(false);
      expect(leaseApi.store.has(LEASE)).toBe(false);

      leaseApi.replaceNamespacedLease = realReplace;
      await lease.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  // TEST_SCENARIO: a failed teardown must not leave the ex-leader's workers running lease-less forever — onLost gets one retry.
  it("retries a failed onLost once", async () => {
    const leaseApi = fakeLeaseApi();
    let lostCalls = 0;
    const lease = makeLease(leaseApi, {
      onAcquired: () => {},
      onLost: () => {
        lostCalls += 1;
        if (lostCalls === 1) throw new Error("bolt stop failed");
      },
    });
    await lease.start();
    expect(lease.isLeader()).toBe(true);

    await lease.stop();
    expect(lostCalls).toBe(2);
    expect(leaseApi.store.has(LEASE)).toBe(false);
  });

  // TEST_SCENARIO: stop() lands while a campaign is still awaiting the API server. The late win must start nothing — the renew timer is already gone, so work started here would run forever on a Lease nobody renews — and the Lease that campaign wrote must not outlive the stop.
  it("does not take leadership from a campaign that resolves after stop", async () => {
    vi.useFakeTimers();
    const leaseApi = fakeLeaseApi();
    let admit: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      admit = resolve;
    });
    const realRead = leaseApi.readNamespacedLease.bind(leaseApi);
    leaseApi.readNamespacedLease = (async (
      args: Parameters<CoordinationV1Api["readNamespacedLease"]>[0],
    ) => {
      await gate;
      return realRead(args);
    }) as CoordinationV1Api["readNamespacedLease"];

    let acquisitions = 0;
    const lease = makeLease(leaseApi, {
      onAcquired: () => void (acquisitions += 1),
      onLost: () => {},
    });

    const starting = lease.start();
    const stopping = lease.stop();
    admit();
    await Promise.all([starting, stopping]);

    try {
      expect(acquisitions).toBe(0);
      expect(lease.isLeader()).toBe(false);
      expect(leaseApi.store.has(LEASE)).toBe(false);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(leaseApi.store.has(LEASE)).toBe(false);
      expect(acquisitions).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // TEST_SCENARIO: the start handler keeps throwing — a DB outage under channelManager.bootstrap. Re-taking the Lease three times a duration would keep rewriting renewTime, so a healthy replica never sees the silence it needs to take over. The failing replica must back off instead.
  it("backs off instead of monopolizing the lease when onAcquired keeps failing", async () => {
    vi.useFakeTimers();
    try {
      const leaseApi = fakeLeaseApi();
      let attempts = 0;
      const lease = makeLease(leaseApi, {
        onAcquired: () => {
          attempts += 1;
          throw new Error("database is down");
        },
        onLost: () => {},
      });

      await lease.start();
      expect(attempts).toBe(1);
      expect(leaseApi.store.has(LEASE)).toBe(false);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(attempts).toBe(1);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(attempts).toBe(2);

      await lease.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  // TEST_SCENARIO: the release handler failed twice, so this replica cannot prove its Slack socket is closed. Deleting the Lease would invite a second consumer, so the Lease stays until this pod is gone and it expires.
  it("keeps the lease when the release handler fails twice", async () => {
    const leaseApi = fakeLeaseApi();
    const lease = makeLease(leaseApi, {
      onAcquired: () => {},
      onLost: () => {
        throw new Error("slack gateway will not close");
      },
    });

    await lease.start();
    expect(leaseApi.store.has(LEASE)).toBe(true);

    await lease.stop();

    expect(lease.isLeader()).toBe(false);
    expect(leaseApi.store.get(LEASE)?.spec?.holderIdentity).toBeTruthy();
  });

  // TEST_SCENARIO: an operator deleting the Lease between the holder's read and its renew must cost nothing — the holder recreates it in the same campaign instead of standing the channel workers down until the next tick.
  it("recreates a lease deleted between the read and the renew", async () => {
    const leaseApi = fakeLeaseApi();
    const lease = makeLease(leaseApi, {
      onAcquired: () => {},
      onLost: () => {},
    });
    await lease.start();

    const realReplace = leaseApi.replaceNamespacedLease.bind(leaseApi);
    leaseApi.replaceNamespacedLease = ((
      args: Parameters<CoordinationV1Api["replaceNamespacedLease"]>[0],
    ) => {
      leaseApi.store.delete(args.name);
      leaseApi.replaceNamespacedLease = realReplace;
      return realReplace(args);
    }) as CoordinationV1Api["replaceNamespacedLease"];

    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lease.isLeader()).toBe(true);
      expect(leaseApi.store.has(LEASE)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    await lease.stop();
  });

  // TEST_SCENARIO: one Lease carries every single-holder role, so the pod that wins it starts them all and the pod that stops it stops them all. Two separate elections could disagree and put the Slack socket on one replica and the agent watch on another.
  it("starts and stops every role on the one lease it holds", async () => {
    const leaseApi = fakeLeaseApi();
    const log: string[] = [];
    const lease = createLeaderLease({
      leases: leaseApi,
      namespace: "platform-agents",
      name: LEASE,
      roles: [
        {
          name: "channels",
          onAcquired: () => void log.push("+channels"),
          onLost: () => void log.push("-channels"),
        },
        {
          name: "agent-watch",
          onAcquired: () => void log.push("+watch"),
          onLost: () => void log.push("-watch"),
        },
      ],
      log: () => {},
    });

    await lease.start();
    expect(log).toEqual(["+channels", "+watch"]);
    expect(lease.isRunning("channels")).toBe(true);
    expect(lease.isRunning("agent-watch")).toBe(true);

    await lease.stop();
    expect(log).toEqual(["+channels", "+watch", "-channels", "-watch"]);
    expect(lease.isRunning("channels")).toBe(false);
    expect(leaseApi.store.has(LEASE)).toBe(false);
  });

  // TEST_SCENARIO: the roles are one unit. A replica that cannot bring up everything the Lease stands for must roll back what did start and let another replica try, rather than hold the election while half-serving.
  it("rolls every role back and releases when one role cannot start", async () => {
    vi.useFakeTimers();
    try {
      const leaseApi = fakeLeaseApi();
      let channelAttempts = 0;
      let watchRunning = false;
      const lease = createLeaderLease({
        leases: leaseApi,
        namespace: "platform-agents",
        name: LEASE,
        roles: [
          {
            name: "channels",
            onAcquired: () => {
              channelAttempts += 1;
              if (channelAttempts < 3) throw new Error("database is down");
            },
            onLost: () => {},
          },
          {
            name: "agent-watch",
            onAcquired: () => void (watchRunning = true),
            onLost: () => void (watchRunning = false),
          },
        ],
        log: () => {},
      });

      await lease.start();
      expect(lease.isLeader()).toBe(false);
      expect(watchRunning).toBe(false);
      expect(leaseApi.store.has(LEASE)).toBe(false);

      await vi.advanceTimersByTimeAsync(40_000);
      expect(channelAttempts).toBe(2);
      expect(lease.isLeader()).toBe(false);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(channelAttempts).toBe(3);
      expect(lease.isLeader()).toBe(true);
      expect(watchRunning).toBe(true);
      expect(lease.isRunning("channels")).toBe(true);

      await lease.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  // TEST_SCENARIO: a role whose stop could not be proven leaves the Lease held, but the role must be recorded as stopped rather than running — otherwise a later win skips starting it, reports it running, and no replica can take the work because the Lease is still held.
  it("can restart a role whose stop failed twice", async () => {
    const leaseApi = fakeLeaseApi();
    let starts = 0;
    let failStop = true;
    const lease = createLeaderLease({
      leases: leaseApi,
      namespace: "platform-agents",
      name: LEASE,
      roles: [
        {
          name: "channels",
          onAcquired: () => void (starts += 1),
          onLost: () => {
            if (failStop) throw new Error("slack gateway will not close");
          },
        },
      ],
      log: () => {},
    });

    await lease.start();
    expect(starts).toBe(1);

    await lease.stop();
    expect(lease.isRunning("channels")).toBe(false);
    expect(leaseApi.store.has(LEASE)).toBe(true);

    await lease.start();
    expect(starts).toBe(2);
    expect(lease.isRunning("channels")).toBe(true);

    failStop = false;
    await lease.stop();
    expect(leaseApi.store.has(LEASE)).toBe(false);
  });

  it("stands down when the K8s API is unreachable rather than acting as leader", async () => {
    const leaseApi = fakeLeaseApi();
    const lease = makeLease(leaseApi, {
      onAcquired: () => {},
      onLost: () => {},
    });
    await lease.start();
    expect(lease.isLeader()).toBe(true);

    vi.spyOn(leaseApi, "readNamespacedLease").mockRejectedValue(
      new Error("ECONNREFUSED"),
    );
    await lease.stop();
    expect(lease.isLeader()).toBe(false);
  });
});
