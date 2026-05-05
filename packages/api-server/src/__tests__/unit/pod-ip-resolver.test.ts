import { afterEach, describe, expect, it, vi } from "vitest";
import type * as k8s from "@kubernetes/client-node";
import {
  createPodIpResolver,
  parseGrpcPeer,
} from "../../modules/agents/infrastructure/pod-ip-resolver.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

function fakeK8s(podSets: Array<Array<{ ip: string; instance: string }>>): {
  client: K8sClient;
  calls: number;
} {
  let i = 0;
  const counter = { calls: 0 };
  const client = {
    listPods: async () => {
      counter.calls++;
      const pods = podSets[Math.min(i++, podSets.length - 1)] ?? [];
      return pods.map(({ ip, instance }) => ({
        metadata: { labels: { "agent-platform.ai/instance": instance } },
        status: { podIP: ip },
      } as k8s.V1Pod));
    },
  } as unknown as K8sClient;
  return { client, calls: counter.calls } as { client: K8sClient; calls: number };
}

describe("parseGrpcPeer", () => {
  it("strips ipv4 prefix + port", () => {
    expect(parseGrpcPeer("ipv4:10.0.0.5:54321")).toBe("10.0.0.5");
  });
  it("strips ipv6 prefix + port for bracketed form", () => {
    expect(parseGrpcPeer("ipv6:[::1]:443")).toBe("::1");
    expect(parseGrpcPeer("ipv6:[fd00::1]:443")).toBe("fd00::1");
  });
  it("handles bare host:port", () => {
    expect(parseGrpcPeer("10.0.0.5:54321")).toBe("10.0.0.5");
  });
  it("returns the input when no port is present", () => {
    expect(parseGrpcPeer("10.0.0.5")).toBe("10.0.0.5");
  });
  it("returns null for malformed bracketed addresses", () => {
    expect(parseGrpcPeer("ipv6:[broken")).toBeNull();
  });
});

describe("podIpResolver", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the instance id for a known pod IP after start()", async () => {
    const { client } = fakeK8s([[{ ip: "10.0.0.5", instance: "inst-A" }]]);
    const resolver = createPodIpResolver({ k8s: client, refreshIntervalMs: 60_000 });
    await resolver.start();
    expect(resolver.resolve("10.0.0.5")).toBe("inst-A");
    await resolver.stop();
  });

  it("returns null for an unknown IP and triggers an out-of-band refresh", async () => {
    // First refresh sees nothing; the on-miss resolve triggers a second
    // refresh that does include the new pod. Subsequent resolve hits.
    const sets: Array<Array<{ ip: string; instance: string }>> = [
      [],
      [{ ip: "10.0.0.6", instance: "inst-B" }],
    ];
    const { client } = fakeK8s(sets);
    const resolver = createPodIpResolver({ k8s: client, refreshIntervalMs: 60_000 });
    await resolver.start();
    expect(resolver.resolve("10.0.0.6")).toBeNull();
    // The miss kicked a refresh; wait a tick for it to land.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(resolver.resolve("10.0.0.6")).toBe("inst-B");
    await resolver.stop();
  });

  it("removes pods that disappear from the next list", async () => {
    const { client } = fakeK8s([
      [{ ip: "10.0.0.7", instance: "inst-C" }],
      [],
    ]);
    const resolver = createPodIpResolver({ k8s: client, refreshIntervalMs: 60_000 });
    await resolver.start();
    expect(resolver.resolve("10.0.0.7")).toBe("inst-C");
    // Trigger second refresh by way of the on-miss refresh path.
    expect(resolver.resolve("10.0.0.99")).toBeNull();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(resolver.resolve("10.0.0.7")).toBeNull();
    await resolver.stop();
  });

  it("single-flights concurrent refreshes", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const client = {
      listPods: async () => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        return [];
      },
    } as unknown as K8sClient;
    const resolver = createPodIpResolver({ k8s: client, refreshIntervalMs: 60_000 });
    await resolver.start();
    // Fire many parallel resolve() calls; each on-miss triggers a refresh.
    for (let i = 0; i < 10; i++) resolver.resolve(`10.0.0.${i}`);
    await new Promise((r) => setTimeout(r, 50));
    // start() ran one refresh; the burst should have collapsed into at
    // most one additional in-flight refresh.
    expect(maxInflight).toBeLessThanOrEqual(1);
    await resolver.stop();
  });

  it("survives a listPods failure and recovers on the next tick", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let attempt = 0;
    const client = {
      listPods: async () => {
        attempt++;
        if (attempt === 1) throw new Error("transient");
        return [
          { metadata: { labels: { "agent-platform.ai/instance": "inst-D" } }, status: { podIP: "10.0.0.8" } } as k8s.V1Pod,
        ];
      },
    } as unknown as K8sClient;
    const resolver = createPodIpResolver({ k8s: client, refreshIntervalMs: 60_000 });
    await resolver.start();
    // First refresh failed; cache is empty.
    expect(resolver.resolve("10.0.0.8")).toBeNull();
    // The miss kicked the second refresh, which succeeds.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(resolver.resolve("10.0.0.8")).toBe("inst-D");
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
    await resolver.stop();
  });
});
