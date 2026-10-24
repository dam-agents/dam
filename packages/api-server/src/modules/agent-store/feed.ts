import type { AgentChangeSubscription } from "../agents/infrastructure/agent-state-cache.js";

export const AGENT_CHANGE_CHANNEL = "agent_changes";

export interface ReadOnlyChangeSource {
  listen(
    channel: string,
    onPayload: (payload: string) => void,
    onSubscribed?: () => void,
  ): Promise<{ unlisten(): Promise<void> }>;
}

export interface AgentChange {
  table: string;
  op: "I" | "U" | "D";
  id?: string;
}

export interface ListenCapableClient {
  listen(
    channel: string,
    onNotify: (payload: string) => void,
    onSubscribed?: () => void,
  ): Promise<{ unlisten: () => Promise<void> }>;
}

export const postgresChangeSource = (
  client: ListenCapableClient,
): ReadOnlyChangeSource => ({
  listen: (channel, onPayload, onSubscribed) =>
    client.listen(channel, onPayload, onSubscribed),
});

export interface AgentChangeFeed {
  start(): Promise<void>;
  stop(): Promise<void>;
  whenChanged(id: string): AgentChangeSubscription;
}

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
export const RELIST_INTERVAL_MS = 30_000;

export function parseAgentChange(payload: string): AgentChange | null {
  try {
    const value = JSON.parse(payload) as Record<string, unknown>;
    const table = typeof value.t === "string" ? value.t : undefined;
    const op = value.op;
    if (!table || (op !== "I" && op !== "U" && op !== "D")) return null;
    const id =
      typeof value.id === "string" && value.id !== "" ? value.id : undefined;
    return id === undefined ? { table, op } : { table, op, id };
  } catch {
    return null;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the api-server's cache wakes on, over the
 * database's own change channel.
 *
 * The order is the whole guarantee: it listens before it lists, buffers what
 * arrives while the list runs, and applies it only after the snapshot is in.
 * The other order loses every change that commits between the list and the
 * subscribe, which is exactly the change a waiter is waiting for.
 *
 * A payload names the table and, except for a budget, the Agent. It is a
 * wake-up, not a source: nothing is applied from it but the fact that a row
 * changed. A budget's notification names no record, so it releases every
 * waiter. A reconnect lists again rather than trusting a cursor, because a
 * sequence number would not be commit order; a half-open connection is bounded
 * by a relist on an interval rather than by the notification.
 */
export function createAgentChangeFeed(deps: {
  source: ReadOnlyChangeSource;
  snapshot: () => Promise<void>;
  log: (message: string, fields?: Record<string, unknown>) => void;
  onChange?: (id: string | null) => void;
  relistIntervalMs?: number;
}): AgentChangeFeed {
  const waiters = new Map<string, Set<() => void>>();

  const release = (id: string) => {
    const pending = waiters.get(id);
    if (!pending) return;
    waiters.delete(id);
    for (const resolve of pending) resolve();
  };
  const releaseAll = () => {
    for (const id of [...waiters.keys()]) release(id);
  };

  let subscription: { unlisten(): Promise<void> } | undefined;
  let relistTimer: NodeJS.Timeout | undefined;
  let stopped = false;
  let buffering = false;
  const buffered = new Set<string | null>();

  const onPayload = (payload: string) => {
    const change = parseAgentChange(payload);
    if (!change) return;
    if (buffering) {
      buffered.add(change.id ?? null);
      return;
    }
    deps.onChange?.(change.id ?? null);
    if (change.id === undefined) releaseAll();
    else release(change.id);
  };

  async function subscribe(): Promise<boolean> {
    let delay = MIN_BACKOFF_MS;
    while (!stopped) {
      try {
        subscription = await deps.source.listen(
          AGENT_CHANGE_CHANNEL,
          onPayload,
          () => {
            if (subscribedBefore) void refresh();
          },
        );
        return true;
      } catch (cause) {
        deps.log("agent store: the change channel is unavailable", {
          error: cause instanceof Error ? cause.message : String(cause),
          retryMs: delay,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
    }
    return false;
  }

  let refreshing: Promise<void> | undefined;

  async function refresh(): Promise<void> {
    if (refreshing !== undefined) return refreshing;
    refreshing = (async () => {
      buffering = true;
      buffered.clear();
      let drained: Array<string | null> = [];
      try {
        await deps.snapshot();
      } catch (cause) {
        deps.log("agent store: the cache could not be listed", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        buffering = false;
        drained = [...buffered];
        buffered.clear();
      }
      /**
       * UNIT_BOUNDARY_DESCRIPTION: what arrived while the snapshot ran committed
       * after the reads the snapshot is made of, so it is not in the snapshot.
       * It invalidates, and only then are the waiters released onto the entry
       * that invalidation left behind.
       */
      if (drained.includes(null)) deps.onChange?.(null);
      for (const id of drained) deps.onChange?.(id);
      if (drained.includes(null)) releaseAll();
      for (const id of drained) if (id !== null) release(id);
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }

  let subscribedBefore = false;

  return {
    async start() {
      if (!(await subscribe())) return;
      subscribedBefore = true;
      await refresh();
      const interval = deps.relistIntervalMs ?? RELIST_INTERVAL_MS;
      relistTimer = setInterval(() => void refresh(), interval);
      relistTimer.unref();
    },
    async stop() {
      stopped = true;
      if (relistTimer) clearInterval(relistTimer);
      const current = subscription;
      subscription = undefined;
      if (current) await current.unlisten().catch(() => {});
      releaseAll();
    },
    whenChanged(id) {
      let resolve!: () => void;
      const changed = new Promise<void>((r) => {
        resolve = r;
      });
      const pending = waiters.get(id) ?? new Set<() => void>();
      pending.add(resolve);
      waiters.set(id, pending);
      return {
        changed,
        cancel() {
          const current = waiters.get(id);
          if (!current) return;
          current.delete(resolve);
          if (current.size === 0) waiters.delete(id);
        },
      };
    },
  };
}
