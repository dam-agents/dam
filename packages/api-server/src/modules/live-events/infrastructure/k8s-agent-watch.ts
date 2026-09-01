import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import type { LiveEventsBus } from "../services/live-events-service.js";

export interface AgentWatchOptions {
  plural: string;
  ownerLabel: string;
  log: (message: string) => void;
  debounceMs?: number;
  volatileAnnotations?: readonly string[];
}

const RECONNECT_MS = 5_000;
const REPLAY_SWEEP_MS = 15_000;

export function startAgentWatch(
  bus: LiveEventsBus,
  k8s: Pick<K8sClient, "watchCustomObjects">,
  opts: AgentWatchOptions,
): { stop(): void } {
  const debounceMs = opts.debounceMs ?? 300;

  let stopped = false;
  let stopWatch: (() => void) | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let seenSinceConnect: Set<string> | null = null;
  const pending = new Map<string, NodeJS.Timeout>();
  const fingerprints = new Map<
    string,
    { fingerprint: string; ownerSub: string }
  >();

  const publish = (agentId: string, ownerSub: string) => {
    const existing = pending.get(agentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pending.delete(agentId);
      bus.publish(ownerSub, { topic: "agents", agentId });
    }, debounceMs);
    timer.unref();
    pending.set(agentId, timer);
  };

  const onEvent = (
    phase: string,
    resource: {
      metadata?: {
        name?: string;
        labels?: Record<string, string>;
        annotations?: Record<string, string>;
      };
      spec?: unknown;
      status?: unknown;
    },
  ) => {
    const metadata = resource.metadata;
    const agentId = metadata?.name;
    const ownerSub = metadata?.labels?.[opts.ownerLabel];
    if (!agentId || !ownerSub) return;

    if (phase === "DELETED") {
      fingerprints.delete(agentId);
      publish(agentId, ownerSub);
      return;
    }
    seenSinceConnect?.add(agentId);

    const annotations = { ...metadata?.annotations };
    for (const key of opts.volatileAnnotations ?? []) delete annotations[key];
    const fingerprint = JSON.stringify({
      labels: metadata?.labels,
      annotations,
      spec: resource.spec,
      status: resource.status,
    });
    if (fingerprints.get(agentId)?.fingerprint === fingerprint) return;
    fingerprints.set(agentId, { fingerprint, ownerSub });
    publish(agentId, ownerSub);
  };

  const connect = () => {
    if (stopped) return;
    const seen = new Set<string>();
    seenSinceConnect = seen;
    if (sweepTimer) clearTimeout(sweepTimer);
    sweepTimer = setTimeout(() => {
      if (stopped || seenSinceConnect !== seen) return;
      seenSinceConnect = null;
      for (const [agentId, entry] of fingerprints) {
        if (seen.has(agentId)) continue;
        fingerprints.delete(agentId);
        publish(agentId, entry.ownerSub);
      }
    }, REPLAY_SWEEP_MS);
    sweepTimer.unref();
    stopWatch = k8s.watchCustomObjects(opts.plural, onEvent, (err) => {
      if (stopped) return;
      if (err) opts.log(`agent watch ended: ${String(err)}`);
      retryTimer = setTimeout(connect, RECONNECT_MS);
      retryTimer.unref();
    });
  };
  connect();

  return {
    stop() {
      stopped = true;
      stopWatch?.();
      if (retryTimer) clearTimeout(retryTimer);
      if (sweepTimer) clearTimeout(sweepTimer);
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}
