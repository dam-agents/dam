import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentDeleted,
  type AgentWoken,
  type ChannelTurnRelayed,
  type KbSharePublished,
  type SessionTurnRelayed,
} from "../../../events.js";
import type { KbShareRow } from "../domain/types.js";

export const KB_SHARE_REFRESH_DEBOUNCE_MS = 3 * 60 * 1000;

export interface KbShareRootsWatchHandle {
  close(): void;
}

export interface KbShareAutoRefreshDeps {
  findActiveByAgent: (agentId: string) => Promise<KbShareRow | null>;
  listDirtyActive: () => Promise<KbShareRow[]>;
  markDirty: (agentId: string) => Promise<boolean>;
  publishAs: (owner: string, agentId: string) => Promise<void>;
  watchRoots?: (
    agentId: string,
    roots: readonly string[],
    handlers: { onNotice: () => void; onDown: () => void },
  ) => KbShareRootsWatchHandle;
  debounceMs?: number;
}

export interface KbShareAutoRefreshSaga {
  unsubscribe(): void;
}

export function startKbShareAutoRefreshSaga(
  deps: KbShareAutoRefreshDeps,
): KbShareAutoRefreshSaga {
  const debounceMs = deps.debounceMs ?? KB_SHARE_REFRESH_DEBOUNCE_MS;
  const timers = new Map<string, NodeJS.Timeout>();
  const watches = new Map<
    string,
    { rootsKey: string; handle: KbShareRootsWatchHandle }
  >();

  function arm(agentId: string, owner: string): void {
    const existing = timers.get(agentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(agentId);
      void (async () => {
        const row = await deps.findActiveByAgent(agentId);
        if (!row || !row.dirtyAt) return;
        await deps.publishAs(owner, agentId);
      })().catch((err: unknown) => {
        process.stderr.write(
          `[kb-share-auto-refresh] publish failed for ${agentId}: ${err}\n`,
        );
      });
    }, debounceMs);
    timer.unref();
    timers.set(agentId, timer);
  }

  function dropWatch(agentId: string): void {
    const entry = watches.get(agentId);
    if (!entry) return;
    watches.delete(agentId);
    entry.handle.close();
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: keeps at most one pod filesystem watch per
   * shared KB, keyed by the share's roots — attached opportunistically on
   * wake, turn, and publish (moments the pod is known up, so a sleeping pod
   * is never dialed), replaced when the roots change, and self-removing when
   * the watch reports down. The watch is a freshness hint only: turn hooks,
   * wake catch-up, and the plan's content-hash diff carry correctness.
   */
  function ensureWatch(row: KbShareRow): void {
    const watchRoots = deps.watchRoots;
    if (!watchRoots) return;
    const rootsKey = row.roots.join("\n");
    const existing = watches.get(row.agentId);
    if (existing && existing.rootsKey === rootsKey) return;
    dropWatch(row.agentId);
    const entry = {
      rootsKey,
      handle: { close: () => {} } as KbShareRootsWatchHandle,
    };
    watches.set(row.agentId, entry);
    try {
      entry.handle = watchRoots(row.agentId, row.roots, {
        onNotice: () => {
          void onShareContentChanged(row.agentId);
        },
        onDown: () => {
          if (watches.get(row.agentId) === entry) watches.delete(row.agentId);
        },
      });
    } catch (err) {
      watches.delete(row.agentId);
      process.stderr.write(
        `[kb-share-auto-refresh] watch attach failed for ${row.agentId}: ${err}\n`,
      );
    }
  }

  async function onShareContentChanged(agentId: string): Promise<void> {
    try {
      const row = await deps.findActiveByAgent(agentId);
      if (!row) {
        dropWatch(agentId);
        return;
      }
      await deps.markDirty(agentId);
      arm(agentId, row.owner);
    } catch (err) {
      process.stderr.write(
        `[kb-share-auto-refresh] watch notice failed for ${agentId}: ${err}\n`,
      );
    }
  }

  async function onTurn(agentId: string): Promise<void> {
    try {
      const row = await deps.findActiveByAgent(agentId);
      if (!row) return;
      await deps.markDirty(agentId);
      arm(agentId, row.owner);
      ensureWatch(row);
    } catch (err) {
      process.stderr.write(
        `[kb-share-auto-refresh] turn handling failed for ${agentId}: ${err}\n`,
      );
    }
  }

  const subscription: Subscription = events$()
    .pipe(
      ofType<SessionTurnRelayed>(EventType.SessionTurnRelayed),
      mergeMap((event) => onTurn(event.agentId)),
    )
    .subscribe();

  subscription.add(
    events$()
      .pipe(
        ofType<ChannelTurnRelayed>(EventType.ChannelTurnRelayed),
        mergeMap((event) => onTurn(event.agentId)),
      )
      .subscribe(),
  );

  subscription.add(
    events$()
      .pipe(
        ofType<AgentWoken>(EventType.AgentWoken),
        mergeMap(async (event) => {
          try {
            const row = await deps.findActiveByAgent(event.agentId);
            if (!row) return;
            ensureWatch(row);
            if (!row.dirtyAt) return;
            arm(event.agentId, row.owner);
          } catch (err) {
            process.stderr.write(
              `[kb-share-auto-refresh] wake catch-up failed for ${event.agentId}: ${err}\n`,
            );
          }
        }),
      )
      .subscribe(),
  );

  subscription.add(
    events$()
      .pipe(
        ofType<KbSharePublished>(EventType.KbSharePublished),
        mergeMap(async (event) => {
          try {
            const row = await deps.findActiveByAgent(event.agentId);
            if (row) ensureWatch(row);
          } catch (err) {
            process.stderr.write(
              `[kb-share-auto-refresh] post-publish watch refresh failed for ${event.agentId}: ${err}\n`,
            );
          }
        }),
      )
      .subscribe(),
  );

  subscription.add(
    events$()
      .pipe(
        ofType<AgentDeleted>(EventType.AgentDeleted),
        mergeMap(async (event) => {
          dropWatch(event.agentId);
        }),
      )
      .subscribe(),
  );

  void (async () => {
    try {
      for (const row of await deps.listDirtyActive()) {
        arm(row.agentId, row.owner);
      }
    } catch (err) {
      process.stderr.write(
        `[kb-share-auto-refresh] dirty-share startup sweep failed: ${err}\n`,
      );
    }
  })();

  return {
    unsubscribe() {
      subscription.unsubscribe();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const entry of watches.values()) entry.handle.close();
      watches.clear();
    },
  };
}
