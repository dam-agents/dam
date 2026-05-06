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
 * Under ADR-038's paired-pod split the calling pod is the gateway, not the
 * agent — both pods of the pair carry the same `agent-platform.ai/instance`
 * label, so we narrow the LIST filter to `role=gateway` to disambiguate.
 * The cache resolves an inbound peer IP to that pod's instance label,
 * which the gate then runs through the existing `identityResolver` to
 * get `(ownerSub, agentId)`. Both StatefulSet gateway pods and fork
 * gateway Pods carry the same labels, so this single cache covers both
 * shapes.
 *
 * Refresh strategy: a periodic re-list (cheap, single Pod LIST per tick).
 * Pods are added/removed at human cadence, so a few seconds of staleness
 * is fine. The first Check from a brand-new pod may miss the cache;
 * `resolve()` triggers a single-flighted refresh on miss to handle that
 * cold-start path without making it the steady state.
 */
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  LABEL_INSTANCE_REF,
  LABEL_ROLE,
  ROLE_GATEWAY,
} from "../../agents/infrastructure/labels.js";

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
        // ADR-038: ext_authz Check calls originate from the paired gateway
        // pod, not the agent. Both pods carry the instance label; narrow
        // to role=gateway so a misdirected agent-pod IP can't satisfy the
        // resolver (it never should — agent pods have no admitted egress
        // to the api-server's ext_authz port — but the explicit filter
        // makes the contract obvious).
        const selector = `${LABEL_INSTANCE_REF},${LABEL_ROLE}=${ROLE_GATEWAY}`;
        const pods = await deps.k8s.listPods(selector);
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
