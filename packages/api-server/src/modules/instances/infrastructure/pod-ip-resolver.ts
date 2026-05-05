/**
 * Pod-IP → instance-id cache for the ext_authz gRPC server.
 *
 * Threat model: the gate must NOT trust the `x-platform-instance` metadata an
 * Envoy sidecar (or a compromised agent bypassing Envoy) sends — it's a
 * plaintext string with no origin proof. The TCP source IP of the gRPC
 * connection IS authoritative under K8s + standard CNIs: pods can't spoof
 * source IPs without CAP_NET_RAW (we drop all caps) or hostNetwork (we
 * never use it for agents). The CNI rewrites/drops any non-pod source IP
 * at egress.
 *
 * This cache resolves an inbound peer IP to the `agent-platform.ai/instance` label
 * carried on the pod, which the gate then runs through the existing
 * `identityResolver` to get `(ownerSub, agentId)`. Both StatefulSet agent
 * pods and fork Jobs carry the label (`ForkLabelInstanceRef` reuses it),
 * so this single cache covers both shapes.
 *
 * Refresh strategy: a periodic re-list (cheap, single Pod LIST per tick).
 * Pods are added/removed at human cadence, so a few seconds of staleness
 * is fine. The first Check from a brand-new pod may miss the cache;
 * `resolve()` triggers a single-flighted refresh on miss to handle that
 * cold-start path without making it the steady state.
 */
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import { LABEL_INSTANCE_REF } from "../../agents/infrastructure/labels.js";

export interface PodIpResolver {
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Returns the instance ID for the pod with this peer IP, or null if no
   * agent/fork pod in the watched namespace owns it. May return a slightly
   * stale value (up to `refreshIntervalMs`); the caller's downstream
   * checks (rule lookup, owner gating) catch any drift.
   *
   * On miss, kicks off an out-of-band refresh so the next Check sees the
   * pod. Returns null synchronously regardless — the caller fails closed.
   */
  resolve(ip: string): string | null;
}

export interface CreatePodIpResolverDeps {
  k8s: K8sClient;
  refreshIntervalMs: number;
}

/** Strip `ipv4:` / `ipv6:` prefix and trailing `:port` from grpc-js's
 *  `getPeer()` format. Handles `ipv4:10.0.0.1:443`, `ipv6:[::1]:443`,
 *  bare `10.0.0.1:443`. Returns the bare IP. */
export function parseGrpcPeer(peer: string): string | null {
  let s = peer;
  if (s.startsWith("ipv4:") || s.startsWith("ipv6:")) s = s.slice(5);
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    return end === -1 ? null : s.slice(1, end);
  }
  const idx = s.lastIndexOf(":");
  return idx === -1 ? s : s.slice(0, idx);
}

export function createPodIpResolver(deps: CreatePodIpResolverDeps): PodIpResolver {
  let cache = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;
  let refreshing: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        // labelSelector with just the key name = "key exists" in K8s.
        const pods = await deps.k8s.listPods(LABEL_INSTANCE_REF);
        const next = new Map<string, string>();
        for (const pod of pods) {
          const ip = pod.status?.podIP;
          const instanceId = pod.metadata?.labels?.[LABEL_INSTANCE_REF];
          if (ip && instanceId) next.set(ip, instanceId);
        }
        cache = next;
      } catch (err) {
        process.stderr.write(
          `[pod-ip-resolver] refresh failed: ${err instanceof Error ? err.message : err}\n`,
        );
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  return {
    async start() {
      await refresh();
      timer = setInterval(() => {
        refresh().catch(() => {});
      }, deps.refreshIntervalMs);
      timer.unref?.();
    },

    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (refreshing) await refreshing.catch(() => {});
    },

    resolve(ip) {
      const hit = cache.get(ip);
      if (hit) return hit;
      // Out-of-band refresh — don't block this Check (caller fails closed
      // synchronously). Next request from the same IP will hit cache.
      refresh().catch(() => {});
      return null;
    },
  };
}
