import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type AgentWoken,
  type ChannelTurnRelayed,
  type SessionTurnRelayed,
} from "../../../events.js";
import type { KbShareRow } from "../domain/types.js";

export const KB_SHARE_REFRESH_DEBOUNCE_MS = 3 * 60 * 1000;

export interface KbShareAutoRefreshDeps {
  findActiveByAgent: (agentId: string) => Promise<KbShareRow | null>;
  listDirtyActive: () => Promise<KbShareRow[]>;
  markDirty: (agentId: string) => Promise<boolean>;
  publishAs: (owner: string, agentId: string) => Promise<void>;
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

  async function onTurn(agentId: string): Promise<void> {
    try {
      const row = await deps.findActiveByAgent(agentId);
      if (!row) return;
      await deps.markDirty(agentId);
      arm(agentId, row.owner);
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
            if (!row || !row.dirtyAt) return;
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
    },
  };
}
