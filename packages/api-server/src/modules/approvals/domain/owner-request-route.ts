import type { OwnerRoute } from "api-server-api";

export type CardReach = "ok" | "unlinked" | "muted";

export interface HoldSituation {
  addressedTurnOpen: boolean;
  releasedTurnOpen: boolean;
  channelTurnOpen: boolean;
  attended: boolean;
  scheduledWebSearch: boolean;
  cardReach: CardReach;
}

export type HoldBasis =
  | "addressed-turn"
  | "released-turn"
  | "unattended-channel-turn"
  | "scheduled-web-search"
  | "hold";

export interface HoldDecision {
  readonly verdict: "hold" | "refuse";
  readonly route: OwnerRoute;
  readonly basis: HoldBasis;
}

// UNIT_BOUNDARY_DESCRIPTION: whether a gate holds an unmatched request for its owner or refuses it at once, and how the request reaches the owner. Five rules, in order: an addressed Slack turn of an owner who can get cards holds on the `turn` route; a Slack turn whose person pressed "Don't wait" refuses, also while someone has the agent open, so a retry does not wait again; a channel turn that nobody attends refuses, because nobody there can answer; a web search of a scheduled session refuses for an owner who cannot get cards; every other request holds on the `background` route. A refused request still files its row for the owner, on the `background` route.
export function decideHold(situation: HoldSituation): HoldDecision {
  if (situation.addressedTurnOpen && situation.cardReach === "ok")
    return { verdict: "hold", route: "turn", basis: "addressed-turn" };
  if (situation.releasedTurnOpen)
    return { verdict: "refuse", route: "background", basis: "released-turn" };
  if (situation.channelTurnOpen && !situation.attended)
    return {
      verdict: "refuse",
      route: "background",
      basis: "unattended-channel-turn",
    };
  if (situation.scheduledWebSearch && situation.cardReach !== "ok")
    return {
      verdict: "refuse",
      route: "background",
      basis: "scheduled-web-search",
    };
  return { verdict: "hold", route: "background", basis: "hold" };
}
