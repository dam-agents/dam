export type OwnerCardReachKind = "ok" | "unlinked" | "muted";

export interface OwnerCardReach {
  reachOf(ownerSub: string): Promise<OwnerCardReachKind>;
}

// UNIT_BOUNDARY_DESCRIPTION: whether an owner can get request cards in Slack, which decides whether an addressed Slack turn holds a request for that owner or refuses it at once. `ok` needs a Slack identity link in a workspace whose install is on record with an active credential; a link with no workspace counts when any install is active. An owner who turned the cards off reads as `muted`, which the decision treats like `unlinked`. Slack's grant set is not stored, so the scopes are checked when a card is posted, not here. With the operator switch off, every owner reads as `unlinked`, which keeps the behavior from before the feature.
export function createOwnerCardReach(deps: {
  enabled: boolean;
  slackLinksOf(
    ownerSub: string,
  ): Promise<ReadonlyArray<{ teamId: string | null }>>;
  installs(): Promise<
    ReadonlyArray<{ teamId: string; credentialState: "active" | "rejected" }>
  >;
  muted(ownerSub: string): Promise<boolean>;
}): OwnerCardReach {
  return {
    async reachOf(ownerSub) {
      if (!deps.enabled) return "unlinked";
      const links = await deps.slackLinksOf(ownerSub);
      if (links.length === 0) return "unlinked";
      const active = new Set(
        (await deps.installs())
          .filter((install) => install.credentialState === "active")
          .map((install) => install.teamId),
      );
      const reachable = links.some((link) =>
        link.teamId === null ? active.size > 0 : active.has(link.teamId),
      );
      if (!reachable) return "unlinked";
      return (await deps.muted(ownerSub)) ? "muted" : "ok";
    },
  };
}
