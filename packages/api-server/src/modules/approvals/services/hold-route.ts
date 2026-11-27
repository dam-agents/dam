import { match } from "ts-pattern";
import type { RefusedIn } from "api-server-api";
import {
  decideHold,
  type CardReach,
  type HoldDecision,
} from "../domain/owner-request-route.js";

// UNIT_BOUNDARY_DESCRIPTION: what the gates read about who attends an agent: whether a channel turn is open and of which kinds, whether an addressed Slack turn or a released one is open, and whether someone has the agent open in a browser or a terminal. Each read covers every api-server replica.
export interface EgressAttendance {
  hasOpenChannelTurn(agentId: string): Promise<boolean>;
  channelTurnKinds(agentId: string): Promise<readonly RefusedIn[]>;
  hasAddressedTurn(agentId: string): Promise<boolean>;
  hasReleasedTurn(agentId: string): Promise<boolean>;
  hasInteractiveSession(agentId: string): Promise<boolean>;
}

// UNIT_BOUNDARY_DESCRIPTION: whether an owner can get request cards in Slack: `ok` when linked in an installed, active workspace, `unlinked` when not or when the operator turned the cards off, `muted` when the owner turned them off.
export interface OwnerCardReach {
  reachOf(ownerSub: string): Promise<CardReach>;
}

export interface RoutedHold extends HoldDecision {
  readonly refusedIn?: RefusedIn;
  readonly addressedTurnOpen: boolean;
}

const REFUSAL_PLACES: readonly RefusedIn[] = [
  "slack",
  "telegram",
  "artifact",
  "unknown",
];

// UNIT_BOUNDARY_DESCRIPTION: reads what the shared hold decision needs for one request and decides it. A read that fails counts toward holding, as before: no addressed or released turn, no reach, and someone attending. A refused request carries where it was refused: a released turn is always a Slack turn, and a channel turn nobody attends names its kind, Slack first.
export async function routeHold(
  deps: { attendance: EgressAttendance; cardReach: OwnerCardReach },
  input: {
    attendee: string;
    ownerSub: string;
    scheduledWebSearch?: () => Promise<boolean>;
  },
): Promise<RoutedHold> {
  const [channelTurnOpen, addressedTurnOpen, releasedTurnOpen, cardReach] =
    await Promise.all([
      deps.attendance.hasOpenChannelTurn(input.attendee).catch(() => false),
      deps.attendance.hasAddressedTurn(input.attendee).catch(() => false),
      deps.attendance.hasReleasedTurn(input.attendee).catch(() => false),
      deps.cardReach.reachOf(input.ownerSub).catch((): CardReach => "unlinked"),
    ]);
  const attended = channelTurnOpen
    ? await deps.attendance
        .hasInteractiveSession(input.attendee)
        .catch(() => true)
    : true;
  const scheduledWebSearch = input.scheduledWebSearch
    ? await input.scheduledWebSearch().catch(() => false)
    : false;
  const decision = decideHold({
    addressedTurnOpen,
    releasedTurnOpen,
    channelTurnOpen,
    attended,
    scheduledWebSearch,
    cardReach,
  });
  const refusedIn = await match(decision.basis)
    .with("released-turn", async (): Promise<RefusedIn> => "slack")
    .with("unattended-channel-turn", async () => {
      const kinds = await deps.attendance
        .channelTurnKinds(input.attendee)
        .catch((): readonly RefusedIn[] => []);
      return REFUSAL_PLACES.find((place) => kinds.includes(place)) ?? "unknown";
    })
    .with(
      "addressed-turn",
      "scheduled-web-search",
      "hold",
      async (): Promise<RefusedIn | undefined> => undefined,
    )
    .exhaustive();
  return {
    ...decision,
    ...(refusedIn ? { refusedIn } : {}),
    addressedTurnOpen,
  };
}
