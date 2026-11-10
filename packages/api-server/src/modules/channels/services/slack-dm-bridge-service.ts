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
import { getLogger } from "../../../core/logger.js";
import type {
  SlackDmBridge,
  SlackDmBridgeState,
} from "../infrastructure/slack-dm-bridges-repository.js";
import type {
  SlackConversationLookup,
  SlackEmailUser,
  SlackWorkspaceIdentity,
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
  | "linked-to-another-workspace"
  | "not-a-direct-message"
  | "slack-failed";

/** UNIT_BOUNDARY_DESCRIPTION: the part of a connect that persisted before a
 *  later step failed, so a caller is told what now exists rather than only what
 *  did not happen. */
export interface SlackDmDestination {
  teamId: string;
  slackUserId: string;
  dmChannelId: string;
}

export type SlackDmFailurePartial = SlackDmDestination & {
  link?: "created" | "existing";
  binding?: "created" | "existing";
  helloPosted?: boolean;
};

export type SlackDmConnectOutcome = SlackDmConnectView;

export type SlackDmResult<T> =
  | ({ ok: true } & T)
  | {
      ok: false;
      code: SlackDmFailureCode;
      message: string;
      partial?: SlackDmFailurePartial;
    };

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Bridge's own record, as the service needs it.
 * Undoing a pairing reads the record it settled rather than today's bindings
 * and links, so a revoke still finishes after a logout removed the link or a
 * failed step removed the binding.
 */
export interface SlackDmBridgeStore {
  settleConnect(input: {
    ownerSub: string;
    agentId: string;
    teamId: string;
    dmChannelId: string;
    slackUserId: string;
    insertEmailLink: boolean;
  }): Promise<
    | {
        ok: true;
        link: {
          keycloakSub: string;
          source: "oauth" | "email";
          teamId: string | null;
        };
        linkCreated: boolean;
        binding: { created: boolean; isDefault: boolean };
        bridge: {
          created: boolean;
          state: SlackDmBridgeState;
          generation: number;
        };
      }
    | {
        ok: false;
        code: "linked-to-another-account" | "linked-to-another-workspace";
        link: {
          keycloakSub: string;
          source: "oauth" | "email";
          teamId: string | null;
        };
      }
  >;
  find(
    agentId: string,
    teamId: string,
    dmChannelId: string,
  ): Promise<SlackDmBridge | null>;
  listForAgent(agentId: string): Promise<SlackDmBridge[]>;
  markRevoking(
    agentId: string,
    teamId: string,
    dmChannelId: string,
    generation: number,
  ): Promise<boolean>;
  stillRevoking(
    agentId: string,
    teamId: string,
    dmChannelId: string,
    generation: number,
  ): Promise<boolean>;
  markRevoked(
    agentId: string,
    teamId: string,
    dmChannelId: string,
    generation: number,
  ): Promise<boolean>;
  claimHello(
    agentId: string,
    teamId: string,
    dmChannelId: string,
  ): Promise<boolean>;
  recordHello(
    agentId: string,
    teamId: string,
    dmChannelId: string,
  ): Promise<void>;
  releaseHello(
    agentId: string,
    teamId: string,
    dmChannelId: string,
  ): Promise<void>;
  releaseBinding(
    agentId: string,
    teamId: string,
    dmChannelId: string,
  ): Promise<void>;
  bindingsInConversation(
    teamId: string,
    dmChannelId: string,
  ): Promise<{ agentId: string; owner: string }[]>;
  listForConversation(
    teamId: string,
    dmChannelId: string,
  ): Promise<SlackDmBridge[]>;
  reopenChannel(agentId: string, slackChannelId: string): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Everything the Bridge needs from the platform and
 * from Slack, as ports, so the pairing rules can be checked without a database
 * or a workspace. `teamId` always names the Slack workspace a call acts for,
 * and `workspace` carries that workspace's identity as its install recorded it;
 * nothing here guesses either.
 */
export interface SlackDmBridgePorts {
  trustedWorkspaces: readonly string[];
  slackConfigured: boolean;
  activeWorkspaces: () => Promise<SlackWorkspaceIdentity[]>;
  grantedScopes: (teamId: string) => Promise<string[] | null>;
  verifiedEmailOf: (keycloakSub: string) => Promise<string | null>;
  linksOf: (keycloakSub: string) => Promise<ExternalLink[]>;
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
  bridges: SlackDmBridgeStore;
  releaseOwnedThreads: (
    agentId: string,
    teamId: string,
    channelId: string,
  ) => Promise<number>;
  unlinkEmailLink: (
    slackUserId: string,
    teamId: string,
    ownerSub: string,
  ) => Promise<number>;
  /* UNIT_BOUNDARY_DESCRIPTION: reports a link this pairing created, for the
   * attribution that reads it; a refused or existing link announces nothing. */
  announceEmailLink: (slackUserId: string, keycloakSub: string) => void;
  /* UNIT_BOUNDARY_DESCRIPTION: `sent` is Slack taking the message, `refused`
   * is Slack saying it did not and so no message exists, and `unknown` is a
   * call nobody saw the answer to — which the greeting never repeats at once,
   * because a duplicate is worse than a late one. */
  postHello: (
    agentId: string,
    slackChannelId: string,
    text: string,
  ) => Promise<"sent" | "refused" | "unknown">;
  brandShort: string;
}

export interface SlackDmBridgeService {
  status(keycloakSub: string): Promise<SlackDmStatusView>;
  connect(
    keycloakSub: string,
    input: { agentId: string; purpose?: string },
  ): Promise<SlackDmResult<SlackDmConnectOutcome>>;
  disconnect(
    keycloakSub: string,
    input: { agentId: string },
  ): Promise<SlackDmResult<SlackDmDisconnectView>>;
  /** UNIT_BOUNDARY_DESCRIPTION: a plain connect of an Agent into a DM this
   *  Bridge released reopens it. */
  reopen(agentId: string, slackChannelId: string): Promise<void>;
  /** UNIT_BOUNDARY_DESCRIPTION: the in-chat unbind, which releases only a DM
   *  this Bridge recorded for that Agent, and reports an unfinished revoke. */
  releaseInChat(input: {
    agentId: string;
    teamId: string;
    slackChannelId: string;
  }): Promise<SlackDmReleaseOutcome>;
  /** UNIT_BOUNDARY_DESCRIPTION: what a DM the Bridge recorded is doing right
   *  now, for the in-chat command to resolve and authorize, and for it to find
   *  a revoke that still has to finish after the binding is gone. */
  pendingInChat(input: {
    teamId: string;
    slackChannelId: string;
  }): Promise<
    { agentId: string; ownerSub: string; state: "active" | "revoking" }[]
  >;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: how an in-chat release ended — `none` for a DM the
 * Bridge never recorded, `revoked` when everything went, `incomplete` when the
 * DM is closed but cleanup must be run again, and `failed` when the record
 * could not even be closed, in which case nothing was deleted and the caller
 * must not claim that anything is closed.
 */
export type SlackDmReleaseOutcome =
  "none" | "revoked" | "incomplete" | "failed";

function refusal(
  code: SlackDmFailureCode,
  message: string,
  partial?: SlackDmFailurePartial,
): Extract<SlackDmResult<never>, { ok: false }> {
  return { ok: false, code, message, ...(partial ? { partial } : {}) };
}

export interface SlackDmRevokeDeps {
  bridges: Pick<
    SlackDmBridgeStore,
    | "find"
    | "markRevoking"
    | "stillRevoking"
    | "markRevoked"
    | "releaseBinding"
    | "bindingsInConversation"
    | "listForConversation"
  >;
  releaseOwnedThreads: (
    agentId: string,
    teamId: string,
    channelId: string,
  ) => Promise<number>;
  unlinkEmailLink: (
    slackUserId: string,
    teamId: string,
    ownerSub: string,
  ) => Promise<number>;
}

export interface SlackDmRevoker {
  revoke(record: SlackDmBridge): Promise<
    | {
        ok: true;
        marked: boolean;
        threadsReleased: number;
        linksRemoved: number;
      }
    | {
        ok: false;
        marked: boolean;
        threadsReleased: number;
        linksRemoved: number;
      }
  >;
  releaseInChat(input: {
    agentId: string;
    teamId: string;
    slackChannelId: string;
  }): Promise<SlackDmReleaseOutcome>;
  /** UNIT_BOUNDARY_DESCRIPTION: what a DM the Bridge recorded is doing right
   *  now, for the in-chat command to resolve and authorize, and for it to find
   *  a revoke that still has to finish after the binding is gone. */
  pendingInChat(input: {
    teamId: string;
    slackChannelId: string;
  }): Promise<
    { agentId: string; ownerSub: string; state: "active" | "revoking" }[]
  >;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: how an in-chat release ended — `none` for a DM the
 * Bridge never recorded, `revoked` when everything went, `incomplete` when the
 * DM is closed but cleanup must be run again, and `failed` when the record
 * could not even be closed, in which case nothing was deleted and the caller
 * must not claim that anything is closed.
 */
/**
 * UNIT_BOUNDARY_DESCRIPTION: Release what the record settled, in an order a
 * retry can finish after any failure: the state refuses turns and delivery
 * before anything is deleted, every step is idempotent, and the link goes last
 * and only when no binding is left in that exact DM. A failure leaves the
 * record `revoking` and is reported, never swallowed.
 */
export function createSlackDmRevoker(deps: SlackDmRevokeDeps): SlackDmRevoker {
  async function revoke(record: SlackDmBridge) {
    const { agentId, teamId, dmChannelId, slackUserId, generation } = record;
    /* UNIT_BOUNDARY_DESCRIPTION: the state write is not the cleanup's to lose:
     * if it fails nothing else is deleted and the caller is told the record is
     * still open, so no one claims the DM is closed when it is not. */
    const marked = await deps.bridges
      .markRevoking(agentId, teamId, dmChannelId, generation)
      .catch(() => false);
    if (!marked)
      return {
        ok: false as const,
        marked: false,
        threadsReleased: 0,
        linksRemoved: 0,
      };
    let threadsReleased = 0;
    let linksRemoved = 0;
    try {
      /* UNIT_BOUNDARY_DESCRIPTION: a connect that reopened this DM in between
       * owns it now, and a stale revoke stops rather than deleting its work. */
      const current = () =>
        deps.bridges.stillRevoking(agentId, teamId, dmChannelId, generation);
      if (!(await current()))
        return {
          ok: false as const,
          marked: true,
          threadsReleased,
          linksRemoved,
        };
      await deps.bridges.releaseBinding(agentId, teamId, dmChannelId);
      threadsReleased = await deps.releaseOwnedThreads(
        agentId,
        teamId,
        dmChannelId,
      );
      if (!(await current()))
        return {
          ok: false as const,
          marked: true,
          threadsReleased,
          linksRemoved,
        };
      const left = await deps.bridges.bindingsInConversation(
        teamId,
        dmChannelId,
      );
      if (left.length === 0)
        linksRemoved = await deps.unlinkEmailLink(
          slackUserId,
          teamId,
          record.ownerSub,
        );
      await deps.bridges.markRevoked(agentId, teamId, dmChannelId, generation);
      return { ok: true as const, marked: true, threadsReleased, linksRemoved };
    } catch {
      return {
        ok: false as const,
        marked: true,
        threadsReleased,
        linksRemoved,
      };
    }
  }

  return {
    revoke,
    async releaseInChat({ agentId, teamId, slackChannelId }) {
      if (!isSlackDirectMessageId(slackChannelId)) return "none";
      const record = await deps.bridges.find(agentId, teamId, slackChannelId);
      if (!record) return "none";
      const released = await revoke(record);
      if (released.ok) return "revoked";
      return released.marked ? "incomplete" : "failed";
    },

    async pendingInChat({ teamId, slackChannelId }) {
      if (!isSlackDirectMessageId(slackChannelId)) return [];
      return (await deps.bridges.listForConversation(teamId, slackChannelId))
        .filter(
          (
            record,
          ): record is SlackDmBridge & { state: "active" | "revoking" } =>
            record.state !== "revoked",
        )
        .map((record) => ({
          agentId: record.agentId,
          ownerSub: record.ownerSub,
          state: record.state,
        }));
    },
  };
}

export function createSlackDmBridgeService(
  deps: SlackDmBridgePorts,
): SlackDmBridgeService {
  /* UNIT_BOUNDARY_DESCRIPTION: The workspaces a lookup may touch, in the order
   * the operator wrote them: a trusted, still-active install whose granted set
   * is known to carry every scope the Bridge needs. An unknown grant set is not
   * a grant — that is what `hasScope` answers elsewhere and must not here. */
  async function searchableWorkspaces(): Promise<{
    workspaces: SlackWorkspaceIdentity[];
    scopesMissing: boolean;
  }> {
    const active = await deps.activeWorkspaces();
    const trusted = deps.trustedWorkspaces.flatMap((teamId) =>
      active.filter((workspace) => workspace.teamId === teamId),
    );
    const workspaces: SlackWorkspaceIdentity[] = [];
    let scopesMissing = false;
    for (const workspace of trusted) {
      const scopes = await deps
        .grantedScopes(workspace.teamId)
        .catch(() => null);
      if (missingRequiredScopes(scopes).length === 0)
        workspaces.push(workspace);
      else scopesMissing = true;
    }
    return { workspaces, scopesMissing };
  }

  async function status(keycloakSub: string): Promise<SlackDmStatusView> {
    if (!deps.slackConfigured || deps.trustedWorkspaces.length === 0)
      return { state: "off", reason: "feature-off" };
    const { workspaces, scopesMissing } = await searchableWorkspaces();
    if (workspaces.length === 0)
      return {
        state: "unavailable",
        reason: scopesMissing ? "scopes" : "no-trusted-workspace",
      };

    const links = (await deps.linksOf(keycloakSub)).filter((link) =>
      workspaces.some((workspace) => workspace.teamId === link.teamId),
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
    for (const workspace of workspaces) {
      const user = await deps.lookupUserByEmail(email, workspace.teamId);
      if (!user) continue;
      if (acceptEmailMatch(user, email, workspace) !== null) continue;
      return {
        state: "pairable",
        teamId: workspace.teamId,
        slackUserId: user.id,
      };
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

  const revoker = createSlackDmRevoker({
    bridges: deps.bridges,
    releaseOwnedThreads: deps.releaseOwnedThreads,
    unlinkEmailLink: deps.unlinkEmailLink,
  });

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
      const destination = {
        teamId,
        slackUserId,
        dmChannelId: dm.channelId,
      };

      const settled = await deps.bridges.settleConnect({
        ownerSub: keycloakSub,
        agentId: input.agentId,
        teamId,
        dmChannelId: dm.channelId,
        slackUserId,
        insertEmailLink: state.state === "pairable",
      });
      if (!settled.ok) {
        const code = settled.code;
        return refusal(
          code,
          code === "linked-to-another-account"
            ? "This Slack account is linked to another account, so it was left alone."
            : "This Slack account is linked in another Slack workspace, so it was left alone.",
          { ...destination, link: "existing" },
        );
      }

      if (settled.linkCreated && settled.link.source === "email")
        deps.announceEmailLink(slackUserId, keycloakSub);

      /* UNIT_BOUNDARY_DESCRIPTION: everything from here on is a step after the
       * settlement committed, so each one reports rather than throws: a person
       * is told what exists now, and a greeting that did not go out is retried
       * by the next connect instead of the whole connect reading as a failure. */
      let helloPosted = false;
      try {
        const otherAgentsBound =
          (await deps.bridges.bindingsInConversation(teamId, dm.channelId))
            .length > 1;
        if (
          await deps.bridges.claimHello(input.agentId, teamId, dm.channelId)
        ) {
          const sent = await deps
            .postHello(
              input.agentId,
              dm.channelId,
              slackDmHello({
                agentName: agent.name,
                brandShort: deps.brandShort,
                purpose: input.purpose,
                isDefault: settled.binding.isDefault,
                otherAgentsBound,
              }),
            )
            .catch(() => "unknown" as const);
          if (sent === "sent") {
            helloPosted = true;
            await deps.bridges.recordHello(input.agentId, teamId, dm.channelId);
          } else if (sent === "refused") {
            /* UNIT_BOUNDARY_DESCRIPTION: Slack refused, so nothing was posted
             * and the next connect may try again straight away. */
            await deps.bridges.releaseHello(
              input.agentId,
              teamId,
              dm.channelId,
            );
          }
        }
      } catch (err) {
        getLogger().warn(
          { agentId: input.agentId, dmChannelId: dm.channelId, err },
          "slack.dm_bridge.greeting_failed",
        );
      }

      return {
        ok: true,
        ...destination,
        link: settled.linkCreated ? "created" : "existing",
        binding: settled.binding.created ? "created" : "existing",
        isDefault: settled.binding.isDefault,
        helloPosted,
      };
    },

    async disconnect(keycloakSub, input) {
      const agent = await deps.agentOf(input.agentId, keycloakSub);
      if (!agent) return refusal("agent-not-found", "That agent is not yours.");

      const records = (await deps.bridges.listForAgent(input.agentId)).filter(
        (record) =>
          record.ownerSub === keycloakSub && record.state !== "revoked",
      );
      let disconnected = 0;
      let threadsReleased = 0;
      let linksRemoved = 0;
      const incomplete: string[] = [];
      for (const record of records) {
        const released = await revoker.revoke(record);
        threadsReleased += released.threadsReleased;
        linksRemoved += released.linksRemoved;
        if (released.ok) disconnected += 1;
        else incomplete.push(record.dmChannelId);
      }
      return {
        ok: true,
        disconnected,
        threadsReleased,
        linksRemoved,
        incomplete,
      };
    },

    reopen(agentId, slackChannelId) {
      return deps.bridges.reopenChannel(agentId, slackChannelId);
    },

    releaseInChat(input) {
      return revoker.releaseInChat(input);
    },

    pendingInChat(input) {
      return revoker.pendingInChat(input);
    },
  };
}
