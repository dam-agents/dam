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
  let connection: { stop(): void } | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let seenSinceConnect: Set<string> | null = null;
  const pending = new Map<
    string,
    { timer: NodeJS.Timeout; trailing: boolean }
  >();
  const fingerprints = new Map<
    string,
    { fingerprint: string; ownerSub: string }
  >();

  // UNIT_BOUNDARY_DESCRIPTION: the debounce is what stops a burst of writes becoming a burst of refetches, and a starting agent is exactly such a burst — the controller rewrites its status about once a second while it boots. Delaying every hint by the window costs that agent's reader the whole of it at the one moment that matters, when the last of those writes is the one saying it is ready. So the first hint of a quiet agent goes out at once and the window suppresses what follows, which still collapses the burst but no longer holds back its beginning; a change arriving inside the window is published when it closes, so the last state is never the one left unsent.
  const publish = (agentId: string, ownerSub: string) => {
    const waiting = pending.get(agentId);
    if (waiting) {
      waiting.trailing = true;
      return;
    }
    bus.publish(ownerSub, { topic: "agents", agentId });
    const entry: { timer: NodeJS.Timeout; trailing: boolean } = {
      trailing: false,
      timer: setTimeout(() => {
        pending.delete(agentId);
        if (entry.trailing) publish(agentId, ownerSub);
      }, debounceMs),
    };
    entry.timer.unref();
    pending.set(agentId, entry);
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
    const link = { stop: () => {} };
    connection = link;
    link.stop = k8s.watchCustomObjects(opts.plural, onEvent, (err) => {
      if (connection !== link) return;
      connection = null;
      link.stop();
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
      connection?.stop();
      if (retryTimer) clearTimeout(retryTimer);
      if (sweepTimer) clearTimeout(sweepTimer);
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
    },
  };
}
