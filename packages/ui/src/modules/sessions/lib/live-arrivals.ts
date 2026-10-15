import type { Message } from "../../../types.js";

export interface LiveArrivals {
  sessionId: string | null;
  primed: boolean;
  known: Set<string>;
  live: Set<string>;
}

export function newLiveArrivals(sessionId: string | null): LiveArrivals {
  return { sessionId, primed: false, known: new Set(), live: new Set() };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which user messages arrived while the session
 * was open — a batch moving in from the queue, a message just sent — so the
 * chat can ease them into place. Messages a load brings, or that were there
 * when the session opened, are known without arriving: opening or reloading a
 * conversation animates nothing. A message stays an arrival for good, so its
 * animation is never cut off by the renders that follow.
 */
export function noteArrivals(
  state: LiveArrivals,
  messages: readonly Message[],
  loading: boolean,
): ReadonlySet<string> {
  for (const m of messages) {
    if (state.known.has(m.id)) continue;
    state.known.add(m.id);
    if (state.primed && !loading && m.role === "user") state.live.add(m.id);
  }
  if (!loading) state.primed = true;
  return state.live;
}
