import type { Db } from "db";
import type {
  AgentChangeSubscription,
  RunningAgentStateCache,
} from "../agents/infrastructure/agent-state-cache.js";
import type { KubeObject } from "../agents/infrastructure/k8s.js";
import { LABEL_OWNER } from "../agents/infrastructure/labels.js";
import type { AgentChangeFeed } from "./feed.js";
import { readAgentRows, readOneAgent } from "./control-read.js";
import { resourceFromRows } from "./rows.js";

const OBSERVE_TIMEOUT_MS = 2_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Agent cache the api-server's readers and its
 * wake polling share, held over the database instead of a watch on the API
 * server.
 *
 * It holds the same shape the watch-backed cache held — one Agent as the rest of
 * the api-server reads it — so nothing downstream changes when the store does.
 * A snapshot is a whole-fleet read through the feed's buffer, and a wakeable
 * waiter is released by the change that names its Agent.
 *
 * The version a caller waits to observe is the definition's generation, which is
 * what the custom resource's resourceVersion meant at every call site that
 * compares one: a write that bumps a rendered column bumps it, and one that only
 * moves a signal does not, exactly as before.
 */
export function createControlAgentStateCache(deps: {
  db: Db;
  feed: AgentChangeFeed;
  log: (message: string, fields?: Record<string, unknown>) => void;
}): RunningAgentStateCache & {
  snapshot(): Promise<void>;
  invalidate(id: string | null): void;
} {
  let cached = new Map<string, KubeObject>();
  let listed = false;
  let stopped = false;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: a read that started before a commit must not
   * overwrite the invalidation that commit's notification caused.
   * Every invalidation bumps a counter, and a read captures it and stores only
   * when it has not moved.
   */
  let generation = 0;
  const stale = new Set<string>();
  let staleAll = false;

  const snapshot = async () => {
    const epoch = generation;
    const rows = await deps.db.transaction(async (tx) => readAgentRows(tx), {
      isolationLevel: "repeatable read",
    });
    if (generation !== epoch) {
      listed = true;
      return;
    }
    const next = new Map<string, KubeObject>();
    for (const row of rows) next.set(row.agent.id, resourceFromRows(row));
    cached = next;
    listed = true;
    stale.clear();
    staleAll = false;
  };

  const live = async (id: string): Promise<KubeObject | null> => {
    const epoch = generation;
    const row = await readOneAgent(deps.db, id);
    const resource = row === null ? null : resourceFromRows(row);
    if (generation === epoch) {
      if (resource === null) cached.delete(id);
      else cached.set(id, resource);
      stale.delete(id);
    }
    return resource;
  };

  const stopFeed = () => deps.feed.stop();

  const invalidate = (id: string | null) => {
    generation += 1;
    if (id === null) {
      staleAll = true;
      return;
    }
    stale.add(id);
  };

  void deps.feed.start().catch((cause) => {
    deps.log("agent store: the cache could not start", {
      error: cause instanceof Error ? cause.message : String(cause),
    });
  });

  return {
    async get(id) {
      if (stopped) return null;
      if (listed && !staleAll && !stale.has(id)) {
        const hit = cached.get(id);
        if (hit) return hit;
      }
      return live(id);
    },
    peekCached(id) {
      if (!listed) return null;
      return cached.get(id) ?? null;
    },
    async list(owner) {
      if (stopped) return [];
      if (!listed || staleAll || stale.size > 0) await snapshot();
      const all = [...cached.values()];
      return owner
        ? all.filter((obj) => obj.metadata?.labels?.[LABEL_OWNER] === owner)
        : all;
    },
    whenChanged(id: string): AgentChangeSubscription {
      return deps.feed.whenChanged(id);
    },
    async awaitObserved(id, version) {
      const target = Number(version);
      const deadline = Date.now() + OBSERVE_TIMEOUT_MS;
      if (!stopped) await live(id);
      while (!stopped && Date.now() < deadline) {
        const seen = Number(cached.get(id)?.metadata?.resourceVersion);
        if (cached.has(id) && (!Number.isFinite(target) || seen >= target))
          return;
        const subscription = deps.feed.whenChanged(id);
        let timer: NodeJS.Timeout | undefined;
        const left = deadline - Date.now();
        await Promise.race([
          subscription.changed,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, left);
          }),
        ]);
        clearTimeout(timer);
        subscription.cancel();
        if (!stopped) await live(id);
      }
    },
    snapshot,
    invalidate,
    async stop() {
      stopped = true;
      cached = new Map();
      listed = false;
      await stopFeed();
    },
  };
}
