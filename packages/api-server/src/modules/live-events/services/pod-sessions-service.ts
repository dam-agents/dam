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
  retry: ReturnType<typeof setTimeout> | undefined;
  closed: boolean;
}

const MAX_PENDING = 256;
const RECONCILE_RETRY_MS = 5_000;

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
            for (const listener of holder.listeners)
              listener({ topic: "sessions", agentId });
          }),
        );
      }
    } catch (error) {
      deps.log(
        `pod-sessions reconcile failed for ${ownerSub}: ${(error as Error).message}`,
      );
      if (!holder.closed && holder.retry === undefined) {
        holder.retry = setTimeout(() => {
          holder.retry = undefined;
          void reconcile(ownerSub);
        }, RECONCILE_RETRY_MS);
        holder.retry.unref?.();
      }
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
        retry: undefined,
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
      if (current.retry) clearTimeout(current.retry);
      current.stopAgentsSignal();
      for (const watch of current.watches.values()) watch.close();
      current.watches.clear();
      holders.delete(ownerSub);
    };
  }

  return {
    async *ownerStream(sub, signal) {
      const pending: PodSessionsNotice[] = [{ topic: "sync" }];
      let wake: (() => void) | undefined;
      const release = acquire(sub, (notice) => {
        if (pending.length >= MAX_PENDING) {
          pending.length = 0;
          pending.push({ topic: "sync" });
        } else {
          pending.push(notice);
        }
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
