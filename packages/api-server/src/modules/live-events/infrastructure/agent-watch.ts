import type { AgentStore } from "../../agents/infrastructure/agent-store.js";
import type { LiveEventsBus } from "../services/live-events-service.js";

export interface AgentWatchOptions {
  debounceMs?: number;
  volatileAnnotations?: readonly string[];
}

/**
 * Projects agent changes into per-owner invalidation hints. The store's
 * emitter cannot drop events the way a K8s watch could, so there is no
 * reconnect or replay sweep here — only the fingerprint check, which keeps
 * supervisor status churn (a heartbeat, an activity stamp) from reaching
 * browsers as a change.
 */
export function startAgentWatch(
  bus: LiveEventsBus,
  store: Pick<AgentStore, "onChange">,
  opts: AgentWatchOptions = {},
): { stop(): void } {
  const debounceMs = opts.debounceMs ?? 300;
  const pending = new Map<string, NodeJS.Timeout>();
  const fingerprints = new Map<string, { fingerprint: string; owner: string }>();

  const publish = (agentId: string, owner: string) => {
    const existing = pending.get(agentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pending.delete(agentId);
      bus.publish(owner, { topic: "agents", agentId });
    }, debounceMs);
    timer.unref();
    pending.set(agentId, timer);
  };

  const unsubscribe = store.onChange((change) => {
    if (change.type === "delete") {
      const known = fingerprints.get(change.id);
      fingerprints.delete(change.id);
      if (known) publish(change.id, known.owner);
      return;
    }
    const { record } = change;
    const annotations = { ...record.annotations };
    for (const key of opts.volatileAnnotations ?? []) delete annotations[key];
    const fingerprint = JSON.stringify({
      owner: record.owner,
      templateId: record.templateId,
      annotations,
      spec: record.spec,
      status: record.status,
    });
    if (fingerprints.get(record.id)?.fingerprint === fingerprint) return;
    fingerprints.set(record.id, { fingerprint, owner: record.owner });
    publish(record.id, record.owner);
  });

  return {
    stop() {
      unsubscribe();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}
