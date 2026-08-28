import type { ArtifactRequestFailureReason } from "api-server-api";

export const AUTO_REQUEST_MIN_GAP_MS = 30_000;

export const AUTO_REQUEST_IDLE_LIMIT_MS = 30 * 60 * 1000;

export type SelfRefreshHold =
  | "bound"
  | "paused"
  | "hidden"
  | "idle"
  | "in_flight"
  | "too_soon";

export interface SelfRefreshClock {
  now: number;
  bound: boolean;
  lastAutoAt: number | null;
  lastActivityAt: number;
  hidden: boolean;
  paused: boolean;
  inFlight: boolean;
}

// UNIT_BOUNDARY_DESCRIPTION: The agent wrote the page's refresh timer, not the person watching it, so an automatic Artifact Request is paced in the browser before it becomes a turn the owner pays for. A page bound to a conversation is refused every automatic ask outright: its turns land in a chat somebody is reading, and a timer would fill that chat with work nobody asked for. The server's caps (60 per artifact per hour, one in flight, no automatic ask on a bound page) stay the backstop; these rules are the everyday path, and they are pure so each one can be checked on its own.
export function selfRefreshHold(
  clock: SelfRefreshClock,
): SelfRefreshHold | null {
  if (clock.bound) return "bound";
  if (clock.paused) return "paused";
  if (clock.hidden) return "hidden";
  if (clock.now - clock.lastActivityAt >= AUTO_REQUEST_IDLE_LIMIT_MS)
    return "idle";
  if (clock.inFlight) return "in_flight";
  if (
    clock.lastAutoAt !== null &&
    clock.now - clock.lastAutoAt < AUTO_REQUEST_MIN_GAP_MS
  )
    return "too_soon";
  return null;
}

export function selfRefreshLabel(hold: SelfRefreshHold | null): string {
  switch (hold) {
    case null:
      return "This page is refreshing itself.";
    case "bound":
      return "This page asks in the conversation it belongs to, so it only asks when you do.";
    case "paused":
      return "You paused this page's own refresh.";
    case "hidden":
      return "This page stops refreshing itself while the tab is in the background.";
    case "idle":
      return "This page stopped refreshing itself after 30 minutes with nobody touching it. Click anything to start it again.";
    case "in_flight":
      return "This page's last request is still with the agent.";
    case "too_soon":
      return "This page may refresh itself once every 30 seconds.";
  }
}

export function holdReason(
  hold: SelfRefreshHold,
): ArtifactRequestFailureReason {
  return hold === "in_flight" ? "busy" : "rate_limited";
}
