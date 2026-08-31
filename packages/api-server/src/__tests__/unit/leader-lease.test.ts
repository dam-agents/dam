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

const LEASE = "platform-channels";

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
      createLeaderLease({
        leases: leaseApi,
        namespace: "platform-agents",
        name: LEASE,
        onAcquired: () => void acquired.push(name),
        onLost: () => {},
        log: () => {},
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
      createLeaderLease({
        leases: leaseApi,
        namespace: "platform-agents",
        name: LEASE,
        onAcquired: () => void events.push(`+${name}`),
        onLost: () => void events.push(`-${name}`),
        log: () => {},
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
      const lease = createLeaderLease({
        leases: leaseApi,
        namespace: "platform-agents",
        name: LEASE,
        onAcquired: () => {},
        onLost: () => {},
        log: () => {},
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
    const broken = createLeaderLease({
      leases: leaseApi,
      namespace: "platform-agents",
      name: LEASE,
      onAcquired: () => {
        events.push("+a");
        throw new Error("slack gateway failed to connect");
      },
      onLost: () => void events.push("-a"),
      log: () => {},
    });
    const healthy = createLeaderLease({
      leases: leaseApi,
      namespace: "platform-agents",
      name: LEASE,
      onAcquired: () => void events.push("+b"),
      onLost: () => void events.push("-b"),
      log: () => {},
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
      const lease = createLeaderLease({
        leases: leaseApi,
        namespace: "platform-agents",
        name: LEASE,
        onAcquired: () => {},
        onLost: () => {},
        log: () => {},
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
    const lease = createLeaderLease({
      leases: leaseApi,
      namespace: "platform-agents",
      name: LEASE,
      onAcquired: () => {},
      onLost: () => {
        lostCalls += 1;
        if (lostCalls === 1) throw new Error("bolt stop failed");
      },
      log: () => {},
    });
    await lease.start();
    expect(lease.isLeader()).toBe(true);

    await lease.stop();
    expect(lostCalls).toBe(2);
    expect(leaseApi.store.has(LEASE)).toBe(false);
  });

  // TEST_SCENARIO: stop() lands while a campaign is still awaiting the API server. The late win must start nothing — the renew timer is already gone, so work started here would run forever on a Lease nobody renews — and the Lease that campaign wrote must not outlive the stop.
  it("does not take leadership from a campaign that resolves after stop", async () => {
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
    const lease = createLeaderLease({
      leases: leaseApi,
      namespace: "platform-agents",
      name: LEASE,
      onAcquired: () => void (acquisitions += 1),
      onLost: () => {},
      log: () => {},
    });

    const starting = lease.start();
    const stopping = lease.stop();
    admit();
    await Promise.all([starting, stopping]);

    expect(acquisitions).toBe(0);
    expect(lease.isLeader()).toBe(false);
    expect(leaseApi.store.has(LEASE)).toBe(false);
  });

  // TEST_SCENARIO: an operator deleting the Lease between the holder's read and its renew must cost nothing — the holder recreates it in the same campaign instead of standing the channel workers down until the next tick.
  it("recreates a lease deleted between the read and the renew", async () => {
    const leaseApi = fakeLeaseApi();
    const lease = createLeaderLease({
      leases: leaseApi,
      namespace: "platform-agents",
      name: LEASE,
      onAcquired: () => {},
      onLost: () => {},
      log: () => {},
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

  it("stands down when the K8s API is unreachable rather than acting as leader", async () => {
    const leaseApi = fakeLeaseApi();
    const lease = createLeaderLease({
      leases: leaseApi,
      namespace: "platform-agents",
      name: LEASE,
      onAcquired: () => {},
      onLost: () => {},
      log: () => {},
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
