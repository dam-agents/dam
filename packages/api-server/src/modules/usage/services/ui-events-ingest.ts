import type { UiEventsInput } from "api-server-api";
import { boundedSet } from "../../../core/bounded-map.js";
import type { UiEventsBatch } from "../infrastructure/ui-events-repository.js";

export const UI_EVENTS_PER_MINUTE = 600;
const WINDOW_MS = 60_000;

export type UiEventsIngest = (
  actorSub: string,
  input: UiEventsInput,
) => Promise<void>;

export function createUiEventsIngest(deps: {
  insert: (batch: UiEventsBatch) => Promise<void>;
  now: () => Date;
}): UiEventsIngest {
  const windows = new Map<string, { startedAt: number; count: number }>();

  function admit(actorSub: string, size: number, at: number): number {
    const current = windows.get(actorSub);
    const window =
      current && at - current.startedAt < WINDOW_MS
        ? current
        : { startedAt: at, count: 0 };
    const admitted = Math.max(
      0,
      Math.min(size, UI_EVENTS_PER_MINUTE - window.count),
    );
    boundedSet(windows, actorSub, {
      ...window,
      count: window.count + admitted,
    });
    return admitted;
  }

  return async (actorSub, { tab, build, events }) => {
    const receivedAt = deps.now();
    const admitted = admit(actorSub, events.length, receivedAt.getTime());
    if (admitted === 0) return;
    await deps.insert({
      actorSub,
      tab,
      build,
      receivedAt,
      events: events.slice(0, admitted),
    });
  };
}
