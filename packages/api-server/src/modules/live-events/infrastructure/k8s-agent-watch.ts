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

export function startAgentWatch(
  bus: LiveEventsBus,
  k8s: Pick<K8sClient, "watchCustomObjects">,
  opts: AgentWatchOptions,
): { stop(): void } {
  const debounceMs = opts.debounceMs ?? 300;

  let stopped = false;
  let stopWatch: (() => void) | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  const pending = new Map<string, NodeJS.Timeout>();
  const fingerprints = new Map<string, string>();

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

    const annotations = { ...metadata?.annotations };
    for (const key of opts.volatileAnnotations ?? []) delete annotations[key];
    const fingerprint = JSON.stringify({
      labels: metadata?.labels,
      annotations,
      spec: resource.spec,
      status: resource.status,
    });
    if (fingerprints.get(agentId) === fingerprint) return;
    fingerprints.set(agentId, fingerprint);
    publish(agentId, ownerSub);
  };

  const connect = () => {
    if (stopped) return;
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
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}
