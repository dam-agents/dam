import type {
  SlackDmConnectView,
  SlackDmDisconnectView,
  SlackDmStatusView,
} from "api-server-api";
import { isSlackDirectMessageId } from "api-server-api";
import type { ExternalLink } from "./identity-link-service.js";
import {
  acceptDirectMessage,
  acceptEmailMatch,
  missingRequiredScopes,
  slackDmHello,
} from "../domain/slack-dm-bridge.js";
import type {
  SlackConversationLookup,
  SlackEmailUser,
} from "../infrastructure/slack-gateway.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Why the Bridge refused, as a code the caller
 * classifies and a sentence it can show. Every refusal leaves the platform as
 * it was: nothing is deleted to compensate for a step that failed, because what
 * exists may predate the Bridge.
 */
export type SlackDmFailureCode =
  | "off"
  | "unavailable"
  | "agent-not-found"
  | "linked-to-another-account"
  | "not-a-direct-message"
  | "binding-failed"
  | "slack-failed";

export type SlackDmResult<T> =
  ({ ok: true } & T) | { ok: false; code: SlackDmFailureCode; message: string };

/**
 * UNIT_BOUNDARY_DESCRIPTION: Everything the Bridge needs from the platform and
 * from Slack, as ports, so the pairing rules can be checked without a database
 * or a workspace. `teamId` always names the Slack workspace a call acts for;
 * nothing here guesses one.
 */
export interface SlackDmBridgePorts {
  trustedWorkspaces: readonly string[];
  slackConfigured: boolean;
  activeWorkspaces: () => Promise<string[]>;
  grantedScopes: (teamId: string) => Promise<string[] | null>;
  verifiedEmailOf: (keycloakSub: string) => Promise<string | null>;
  linksOf: (keycloakSub: string) => Promise<ExternalLink[]>;
  linkOfExternalUser: (
    externalUserId: string,
  ) => Promise<{ keycloakSub: string; source: "oauth" | "email" } | null>;
  linkByEmail: (
    externalUserId: string,
    keycloakSub: string,
    teamId: string,
  ) => Promise<void>;
  unlinkEmailOf: (keycloakSub: string, teamId: string) => Promise<number>;
  lookupUserByEmail: (
    email: string,
    teamId: string,
  ) => Promise<SlackEmailUser | null>;
  openDirectMessage: (slackUserId: string, teamId: string) => Promise<string>;
  conversationInfo: (
    channelId: string,
    teamId: string,
  ) => Promise<SlackConversationLookup>;
  agentOf: (
    agentId: string,
    keycloakSub: string,
  ) => Promise<{ id: string; name: string } | null>;
  bindingsOf: (
    agentId: string,
  ) => Promise<
    { slackChannelId: string; teamId: string; isDefault: boolean }[]
  >;
  bindingsInConversation: (
    slackChannelId: string,
  ) => Promise<{ agentId: string; owner: string }[]>;
  bindAgent: (
    agentId: string,
    slackChannelId: string,
  ) => Promise<{ ok: true; isDefault: boolean } | { ok: false; error: string }>;
  unbindAgent: (agentId: string, slackChannelId: string) => Promise<void>;
  releaseOwnedThreads: (
    agentId: string,
    slackChannelId: string,
  ) => Promise<number>;
  postHello: (
    agentId: string,
    slackChannelId: string,
    text: string,
  ) => Promise<boolean>;
  brandShort: string;
}

export interface SlackDmBridgeService {
  status(keycloakSub: string): Promise<SlackDmStatusView>;
  connect(
    keycloakSub: string,
    input: { agentId: string; purpose?: string },
  ): Promise<SlackDmResult<SlackDmConnectView>>;
  disconnect(
    keycloakSub: string,
    input: { agentId: string },
  ): Promise<SlackDmResult<SlackDmDisconnectView>>;
}

function refusal(
  code: SlackDmFailureCode,
  message: string,
): { ok: false; code: SlackDmFailureCode; message: string } {
  return { ok: false, code, message };
}

export function createSlackDmBridgeService(
  deps: SlackDmBridgePorts,
): SlackDmBridgeService {
  /* UNIT_BOUNDARY_DESCRIPTION: The workspaces a lookup may touch, in the order
   * the operator wrote them: a trusted, still-active install whose granted set
   * is known to carry every scope the Bridge needs. An unknown grant set is not
   * a grant — that is what `hasScope` answers elsewhere and must not here. */
  async function searchableWorkspaces(): Promise<{
    teamIds: string[];
    scopesMissing: boolean;
  }> {
    const active = new Set(await deps.activeWorkspaces());
    const trusted = deps.trustedWorkspaces.filter((teamId) =>
      active.has(teamId),
    );
    const ready: string[] = [];
    let scopesMissing = false;
    for (const teamId of trusted) {
      const scopes = await deps.grantedScopes(teamId).catch(() => null);
      if (missingRequiredScopes(scopes).length === 0) ready.push(teamId);
      else scopesMissing = true;
    }
    return { teamIds: ready, scopesMissing };
  }

  async function status(keycloakSub: string): Promise<SlackDmStatusView> {
    if (!deps.slackConfigured || deps.trustedWorkspaces.length === 0)
      return { state: "off", reason: "feature-off" };
    const { teamIds, scopesMissing } = await searchableWorkspaces();
    if (teamIds.length === 0)
      return {
        state: "unavailable",
        reason: scopesMissing ? "scopes" : "no-trusted-workspace",
      };

    const links = (await deps.linksOf(keycloakSub)).filter((link) =>
      teamIds.includes(link.teamId ?? ""),
    );
    if (links.length > 0) {
      return {
        state: "linked",
        teamId: links[0]!.teamId ?? undefined,
        slackUserId: links[0]!.externalUserId,
      };
    }

    /* UNIT_BOUNDARY_DESCRIPTION: An unreachable directory is not an unverified
     * mailbox — it is no answer at all, and the pairing fails closed either way. */
    const email = await deps.verifiedEmailOf(keycloakSub).catch(() => null);
    if (!email) return { state: "unavailable", reason: "email" };
    for (const teamId of teamIds) {
      const user = await deps.lookupUserByEmail(email, teamId);
      if (!user) continue;
      if (acceptEmailMatch(user, email, teamId) !== null) continue;
      return { state: "pairable", teamId, slackUserId: user.id };
    }
    return { state: "unavailable", reason: "no-match" };
  }

  /* UNIT_BOUNDARY_DESCRIPTION: The 1:1 DM with the matched person, or the
   * refusal that says why the conversation is not that. Opening first and
   * settling state after is what keeps a failed connect from leaving a link
   * that routes platform notices to someone the Bridge never reached. */
  async function openOwnerDm(
    slackUserId: string,
    teamId: string,
  ): Promise<
    | { ok: true; channelId: string }
    | { ok: false; code: SlackDmFailureCode; message: string }
  > {
    let channelId: string;
    try {
      channelId = await deps.openDirectMessage(slackUserId, teamId);
    } catch (err) {
      return refusal(
        "slack-failed",
        `Slack could not open the direct message: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const info = await deps.conversationInfo(channelId, teamId);
    if (info.kind !== "found")
      return refusal(
        "not-a-direct-message",
        "Slack did not show the conversation as a direct message with that person.",
      );
    const rejected = acceptDirectMessage(info, slackUserId);
    if (rejected === "not-a-dm")
      return refusal(
        "not-a-direct-message",
        "That conversation is a group direct message, not a 1:1 with the person.",
      );
    if (rejected === "dm-with-someone-else")
      return refusal(
        "not-a-direct-message",
        "That conversation is a direct message with someone else.",
      );
    return { ok: true, channelId };
  }

  return {
    status,

    async connect(keycloakSub, input) {
      const agent = await deps.agentOf(input.agentId, keycloakSub);
      if (!agent) return refusal("agent-not-found", "That agent is not yours.");

      const state = await status(keycloakSub);
      if (state.state === "off") return refusal("off", "email pairing is off");
      if (state.state === "unavailable")
        return refusal(
          "unavailable",
          `pairing is unavailable: ${state.reason}`,
        );
      const teamId = state.teamId;
      const slackUserId = state.slackUserId;
      if (!teamId || !slackUserId)
        return refusal("unavailable", "pairing is unavailable");

      const dm = await openOwnerDm(slackUserId, teamId);
      if (!dm.ok) return dm;

      if (state.state === "pairable") {
        await deps.linkByEmail(slackUserId, keycloakSub, teamId);
        const link = await deps.linkOfExternalUser(slackUserId);
        if (link?.keycloakSub !== keycloakSub)
          return refusal(
            "linked-to-another-account",
            "This Slack account is linked to another account, so it was left alone.",
          );
      }

      const existing = (await deps.bindingsOf(input.agentId)).find(
        (binding) => binding.slackChannelId === dm.channelId,
      );
      if (existing)
        return {
          ok: true,
          teamId,
          slackUserId,
          dmChannelId: dm.channelId,
          binding: "existing",
          isDefault: existing.isDefault,
          helloPosted: false,
        };

      const bound = await deps.bindAgent(input.agentId, dm.channelId);
      if (!bound.ok) return refusal("binding-failed", bound.error);

      const helloPosted = await deps.postHello(
        input.agentId,
        dm.channelId,
        slackDmHello({
          agentName: agent.name,
          brandShort: deps.brandShort,
          purpose: input.purpose,
          isDefault: bound.isDefault,
        }),
      );

      return {
        ok: true,
        teamId,
        slackUserId,
        dmChannelId: dm.channelId,
        binding: "created",
        isDefault: bound.isDefault,
        helloPosted,
      };
    },

    async disconnect(keycloakSub, input) {
      const agent = await deps.agentOf(input.agentId, keycloakSub);
      if (!agent) return refusal("agent-not-found", "That agent is not yours.");

      const links = await deps.linksOf(keycloakSub);
      let disconnected = 0;
      let threadsReleased = 0;
      let linksRemoved = 0;
      for (const binding of await deps.bindingsOf(input.agentId)) {
        if (!isSlackDirectMessageId(binding.slackChannelId)) continue;
        const owners = links.filter((link) => link.teamId === binding.teamId);
        if (owners.length === 0) continue;
        const info = await deps
          .conversationInfo(binding.slackChannelId, binding.teamId)
          .catch(() => ({ kind: "not-found" }) as const);
        if (
          info.kind !== "found" ||
          !info.isDirectMessage ||
          info.isGroupDirectMessage
        )
          continue;
        const dmUser = info.directMessageUser;
        if (!owners.some((link) => link.externalUserId === dmUser)) continue;

        await deps.unbindAgent(input.agentId, binding.slackChannelId);
        disconnected += 1;
        threadsReleased += await deps.releaseOwnedThreads(
          input.agentId,
          binding.slackChannelId,
        );
        if (
          (await deps.bindingsInConversation(binding.slackChannelId)).length ===
          0
        )
          linksRemoved += await deps.unlinkEmailOf(keycloakSub, binding.teamId);
      }
      return { ok: true, disconnected, threadsReleased, linksRemoved };
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What `/dam unbind` leaves behind in a 1:1 DM: the
 * binding is already gone, and the threads that agent's sessions owned there go
 * with it; the email pairing that put them there goes last, and only while
 * nobody is bound in that DM any more. A proven link and every other binding
 * stay.
 */
export function createSlackDmBridgeRelease(deps: {
  releaseOwnedThreads: (
    agentId: string,
    slackChannelId: string,
  ) => Promise<number>;
  bindingsInConversation: (
    slackChannelId: string,
  ) => Promise<{ agentId: string; owner: string }[]>;
  unlinkEmailOf: (keycloakSub: string, teamId: string) => Promise<number>;
}) {
  return async (args: {
    agentId: string;
    slackChannelId: string;
    teamId: string;
    ownerSub: string;
  }): Promise<void> => {
    if (!isSlackDirectMessageId(args.slackChannelId)) return;
    await deps.releaseOwnedThreads(args.agentId, args.slackChannelId);
    if ((await deps.bindingsInConversation(args.slackChannelId)).length > 0)
      return;
    await deps.unlinkEmailOf(args.ownerSub, args.teamId);
  };
}
