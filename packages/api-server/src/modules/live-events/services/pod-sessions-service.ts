import type { PodSessionsNotice, PodSessionsService } from "api-server-api";

export interface PodSessionWatch {
  close(): void;
}

export interface PodSessionsDeps {
  listRunningAgentIds(ownerSub: string): Promise<string[]>;
  watchAgent(agentId: string, onNotice: () => void): PodSessionWatch;
  onAgentsChanged(ownerSub: string, listener: () => void): () => void;
  log: (message: string) => void;
}

interface OwnerHolder {
  listeners: Set<(notice: PodSessionsNotice) => void>;
  watches: Map<string, PodSessionWatch>;
  stopAgentsSignal: () => void;
  reconciling: boolean;
  again: boolean;
  closed: boolean;
}

export function createPodSessionsService(
  deps: PodSessionsDeps,
): PodSessionsService {
  const holders = new Map<string, OwnerHolder>();

  async function reconcile(ownerSub: string): Promise<void> {
    const holder = holders.get(ownerSub);
    if (!holder || holder.closed) return;
    if (holder.reconciling) {
      holder.again = true;
      return;
    }
    holder.reconciling = true;
    try {
      const running = new Set(await deps.listRunningAgentIds(ownerSub));
      if (holder.closed) return;

      for (const [agentId, watch] of [...holder.watches]) {
        if (running.has(agentId)) continue;
        watch.close();
        holder.watches.delete(agentId);
      }
      for (const agentId of running) {
        if (holder.watches.has(agentId)) continue;
        holder.watches.set(
          agentId,
          deps.watchAgent(agentId, () => {
            for (const listener of holder.listeners) listener({ agentId });
          }),
        );
      }
    } catch (error) {
      deps.log(
        `pod-sessions reconcile failed for ${ownerSub}: ${(error as Error).message}`,
      );
    } finally {
      holder.reconciling = false;
      if (holder.again && !holder.closed) {
        holder.again = false;
        void reconcile(ownerSub);
      }
    }
  }

  function acquire(
    ownerSub: string,
    listener: (notice: PodSessionsNotice) => void,
  ): () => void {
    let holder = holders.get(ownerSub);
    if (!holder) {
      holder = {
        listeners: new Set(),
        watches: new Map(),
        stopAgentsSignal: () => {},
        reconciling: false,
        again: false,
        closed: false,
      };
      holders.set(ownerSub, holder);
      holder.stopAgentsSignal = deps.onAgentsChanged(ownerSub, () => {
        void reconcile(ownerSub);
      });
      void reconcile(ownerSub);
    }
    holder.listeners.add(listener);

    return () => {
      const current = holders.get(ownerSub);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size > 0) return;
      current.closed = true;
      current.stopAgentsSignal();
      for (const watch of current.watches.values()) watch.close();
      current.watches.clear();
      holders.delete(ownerSub);
    };
  }

  return {
    async *ownerStream(sub, signal) {
      const pending: PodSessionsNotice[] = [];
      let wake: (() => void) | undefined;
      const release = acquire(sub, (notice) => {
        pending.push(notice);
        wake?.();
      });
      const onAbort = () => wake?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        while (!signal?.aborted) {
          const next = pending.shift();
          if (next === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
            continue;
          }
          yield next;
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
        release();
      }
    },
  };
}
