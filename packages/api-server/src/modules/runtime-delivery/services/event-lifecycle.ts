import type { PendingEventRow } from "../infrastructure/outbox-repo.js";

export type EventLifecycleTransition = "settled" | "expired";

export type EventLifecycleListener = (
  event: PendingEventRow,
  transition: EventLifecycleTransition,
) => Promise<void>;

export type EventLifecycleNotifier = (
  events: readonly PendingEventRow[],
  transition: EventLifecycleTransition,
) => Promise<void>;

export function createEventLifecycleNotifier(
  listenerFor: (kind: string) => EventLifecycleListener | undefined,
  log: (msg: string) => void,
): EventLifecycleNotifier {
  return async (events, transition) => {
    for (const event of events) {
      const listener = listenerFor(event.kind);
      if (!listener) continue;
      await listener(event, transition).catch((err: Error) =>
        log(
          `[runtime-lifecycle] ${event.agentId}: ${transition} listener for ${event.id} failed: ${err.message}`,
        ),
      );
    }
  };
}
