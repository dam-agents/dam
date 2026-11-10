import type { Db } from "db";
import { and, channels, eq, identityLinks, slackDmBridges, sql } from "db";
import { ChannelType } from "api-server-api";
import type { Tx } from "../../../core/unit-of-work.js";
import {
  insertEmailIdentityLinkIfAbsent,
  type IdentityLinkSource,
} from "./identity-links-repository.js";

export type SlackDmBridgeState = "active" | "revoking" | "revoked";

export interface SlackDmBridge {
  agentId: string;
  teamId: string;
  dmChannelId: string;
  ownerSub: string;
  slackUserId: string;
  state: SlackDmBridgeState;
  generation: number;
  helloClaimedAt: Date | null;
  helloPostedAt: Date | null;
}

export interface SlackDmLink {
  keycloakSub: string;
  source: IdentityLinkSource;
  teamId: string | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a connect settled, and whether this call was
 * the one that made it. A refusal still reports the link it found, because the
 * caller must never overwrite or delete a link another person proved.
 */
export type SlackDmSettleResult =
  | {
      ok: true;
      link: SlackDmLink;
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
      link: SlackDmLink;
    };

/** UNIT_BOUNDARY_DESCRIPTION: what a connect asks the store to settle;
 *  `insertEmailLink` is the pairing writing the link it found the person by,
 *  which only ever inserts. */
export interface SlackDmSettleInput {
  ownerSub: string;
  agentId: string;
  teamId: string;
  dmChannelId: string;
  slackUserId: string;
  insertEmailLink: boolean;
}

/** UNIT_BOUNDARY_DESCRIPTION: a binding is its (Agent, workspace, conversation)
 *  triple, so every Bridge read, claim and delete names the workspace too: two
 *  workspaces may share a conversation id, and releasing one must not release
 *  the other. Exported for the check that renders it. */
export const slackBindingInConversation = (
  teamId: string,
  dmChannelId: string,
) =>
  and(
    eq(channels.type, ChannelType.Slack),
    sql`coalesce(${channels.config}->>'teamId', '') = ${teamId}`,
    sql`${channels.config}->>'slackChannelId' = ${dmChannelId}`,
  );

function toBridge(row: typeof slackDmBridges.$inferSelect): SlackDmBridge {
  return {
    agentId: row.agentId,
    teamId: row.teamId,
    dmChannelId: row.dmChannelId,
    ownerSub: row.ownerSub,
    slackUserId: row.slackUserId,
    state: row.state,
    generation: row.generation,
    helloClaimedAt: row.helloClaimedAt,
    helloPostedAt: row.helloPostedAt,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Bridge's own record of what it settled, and
 * the writes that keep undoing it possible. The record exists because a revoke
 * must not depend on live Slack answers, on a binding another path may have
 * deleted, or on a link a logout already removed: it names the exact
 * destination — agent, workspace, DM, person — and its state is what stops
 * turns and delivery there, including after a revoke that failed halfway.
 *
 * A connect settles under one transaction and one row lock: the link is
 * inserted or read `for update`, so a concurrent Keycloak sign-in cannot swap
 * the owner underneath it; the binding is created only when absent, inside the
 * workspace it was proven in; and the record's insert answers whether this call
 * created it, which is the only caller that may greet.
 */
export function createSlackDmBridgesRepository(db: Db) {
  const tx = <T>(fn: (tx: Tx) => Promise<T>) => db.transaction(fn);

  async function settleConnect(
    input: SlackDmSettleInput,
  ): Promise<SlackDmSettleResult> {
    try {
      const settled = await tx(async (t) => {
        const linkCreated = input.insertEmailLink
          ? await insertEmailIdentityLinkIfAbsent(t)(
              "slack",
              input.slackUserId,
              input.ownerSub,
              input.teamId,
            )
          : false;
        const locked = (
          await t
            .select({
              keycloakSub: identityLinks.keycloakSub,
              source: identityLinks.source,
              teamId: identityLinks.teamId,
            })
            .from(identityLinks)
            .where(
              and(
                eq(identityLinks.provider, "slack"),
                eq(identityLinks.externalUserId, input.slackUserId),
              ),
            )
            .limit(1)
            .for("update")
        )[0];
        if (!locked)
          throw new Error("identity link vanished under the connect");
        const link: SlackDmLink = {
          keycloakSub: locked.keycloakSub,
          source: locked.source === "email" ? "email" : "oauth",
          teamId: locked.teamId,
        };
        if (link.keycloakSub !== input.ownerSub)
          throw new LinkedElsewhere("linked-to-another-account", link);
        if (link.teamId !== null && link.teamId !== input.teamId)
          throw new LinkedElsewhere("linked-to-another-workspace", link);

        const existing = (
          await t
            .select({ config: channels.config })
            .from(channels)
            .where(
              and(
                eq(channels.agentId, input.agentId),
                slackBindingInConversation(input.teamId, input.dmChannelId),
              ),
            )
            .limit(1)
        )[0];
        let created = false;
        if (!existing) {
          const inserted = await t
            .insert(channels)
            .values({
              agentId: input.agentId,
              owner: input.ownerSub,
              type: ChannelType.Slack,
              config: {
                slackChannelId: input.dmChannelId,
                teamId: input.teamId,
              },
            })
            .onConflictDoNothing()
            .returning({ agentId: channels.agentId });
          created = inserted.length > 0;
        }
        const isDefault = await claimDefaultIfVacant(
          t,
          input.agentId,
          input.teamId,
          input.dmChannelId,
        );

        const bridge = (
          await t
            .insert(slackDmBridges)
            .values({
              agentId: input.agentId,
              teamId: input.teamId,
              dmChannelId: input.dmChannelId,
              ownerSub: input.ownerSub,
              slackUserId: input.slackUserId,
              state: "active",
            })
            .onConflictDoUpdate({
              target: [
                slackDmBridges.agentId,
                slackDmBridges.teamId,
                slackDmBridges.dmChannelId,
              ],
              set: {
                ownerSub: input.ownerSub,
                slackUserId: input.slackUserId,
                state: "active",
                generation: sql`${slackDmBridges.generation} + 1`,
                /* UNIT_BOUNDARY_DESCRIPTION: a reopen greets again, since the
                 * DM was closed and is being handed back; a re-connect of a DM
                 * that stayed open keeps the greeting it already posted. */
                helloPostedAt: sql`case when ${slackDmBridges.state} = 'active' then ${slackDmBridges.helloPostedAt} else null end`,
                helloClaimedAt: sql`case when ${slackDmBridges.state} = 'active' then ${slackDmBridges.helloClaimedAt} else null end`,
                updatedAt: sql`now()`,
              },
            })
            .returning({
              inserted: sql<boolean>`xmax = 0`,
              state: slackDmBridges.state,
              generation: slackDmBridges.generation,
            })
        )[0]!;

        return {
          link,
          linkCreated,
          binding: { created, isDefault },
          bridge: {
            created: bridge.inserted,
            state: bridge.state,
            generation: bridge.generation,
          },
        };
      });
      return { ok: true, ...settled };
    } catch (err) {
      if (err instanceof LinkedElsewhere)
        return { ok: false, code: err.code, link: err.link };
      throw err;
    }
  }

  async function claimDefaultIfVacant(
    t: Tx,
    agentId: string,
    teamId: string,
    dmChannelId: string,
  ): Promise<boolean> {
    const taken = (
      await t
        .select({ agentId: channels.agentId })
        .from(channels)
        .where(
          and(
            slackBindingInConversation(teamId, dmChannelId),
            sql`${channels.config}->>'default' = 'true'`,
          ),
        )
        .limit(1)
    )[0];
    if (taken) return taken.agentId === agentId;
    const claimed = await t
      .update(channels)
      .set({ config: sql`${channels.config} || '{"default": true}'::jsonb` })
      .where(
        and(
          eq(channels.agentId, agentId),
          slackBindingInConversation(teamId, dmChannelId),
        ),
      )
      .returning({ agentId: channels.agentId });
    return claimed.length > 0;
  }

  return {
    settleConnect,

    async find(
      agentId: string,
      teamId: string,
      dmChannelId: string,
    ): Promise<SlackDmBridge | null> {
      const rows = await db
        .select()
        .from(slackDmBridges)
        .where(
          and(
            eq(slackDmBridges.agentId, agentId),
            eq(slackDmBridges.teamId, teamId),
            eq(slackDmBridges.dmChannelId, dmChannelId),
          ),
        )
        .limit(1);
      return rows[0] ? toBridge(rows[0]) : null;
    },

    async listForAgent(agentId: string): Promise<SlackDmBridge[]> {
      const rows = await db
        .select()
        .from(slackDmBridges)
        .where(eq(slackDmBridges.agentId, agentId));
      return rows.map(toBridge);
    },

    async listForConversation(
      teamId: string,
      dmChannelId: string,
    ): Promise<SlackDmBridge[]> {
      const rows = await db
        .select()
        .from(slackDmBridges)
        .where(
          and(
            eq(slackDmBridges.teamId, teamId),
            eq(slackDmBridges.dmChannelId, dmChannelId),
          ),
        );
      return rows.map(toBridge);
    },

    /** UNIT_BOUNDARY_DESCRIPTION: whether turns and delivery into that DM are
     *  closed. A record that is not `active` — or one this call could not read
     *  at all — answers closed. */
    async blocked(
      agentId: string,
      teamId: string,
      dmChannelId: string,
    ): Promise<boolean> {
      const rows = await db
        .select({ state: slackDmBridges.state })
        .from(slackDmBridges)
        .where(
          and(
            eq(slackDmBridges.agentId, agentId),
            eq(slackDmBridges.teamId, teamId),
            eq(slackDmBridges.dmChannelId, dmChannelId),
          ),
        )
        .limit(1);
      return rows[0] === undefined ? false : rows[0].state !== "active";
    },

    /** UNIT_BOUNDARY_DESCRIPTION: close the DM for turns and delivery before
     *  anything is deleted. Conditional on the generation the revoke read, so a
     *  connect that happened in between is not closed by a stale revoke. */
    async markRevoking(
      agentId: string,
      teamId: string,
      dmChannelId: string,
      generation: number,
    ): Promise<boolean> {
      const marked = await db
        .update(slackDmBridges)
        .set({ state: "revoking", updatedAt: sql`now()` })
        .where(
          and(
            eq(slackDmBridges.agentId, agentId),
            eq(slackDmBridges.teamId, teamId),
            eq(slackDmBridges.dmChannelId, dmChannelId),
            eq(slackDmBridges.generation, generation),
            sql`${slackDmBridges.state} <> 'revoked'`,
          ),
        )
        .returning({ agentId: slackDmBridges.agentId });
      return marked.length > 0;
    },

    async stillRevoking(
      agentId: string,
      teamId: string,
      dmChannelId: string,
      generation: number,
    ): Promise<boolean> {
      const rows = await db
        .select({ state: slackDmBridges.state })
        .from(slackDmBridges)
        .where(
          and(
            eq(slackDmBridges.agentId, agentId),
            eq(slackDmBridges.teamId, teamId),
            eq(slackDmBridges.dmChannelId, dmChannelId),
            eq(slackDmBridges.generation, generation),
            eq(slackDmBridges.state, "revoking"),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async markRevoked(
      agentId: string,
      teamId: string,
      dmChannelId: string,
      generation: number,
    ): Promise<boolean> {
      const marked = await db
        .update(slackDmBridges)
        .set({ state: "revoked", updatedAt: sql`now()` })
        .where(
          and(
            eq(slackDmBridges.agentId, agentId),
            eq(slackDmBridges.teamId, teamId),
            eq(slackDmBridges.dmChannelId, dmChannelId),
            eq(slackDmBridges.generation, generation),
            eq(slackDmBridges.state, "revoking"),
          ),
        )
        .returning({ agentId: slackDmBridges.agentId });
      return marked.length > 0;
    },

    /** UNIT_BOUNDARY_DESCRIPTION: one caller holds the greeting at a time, and a
     *  claim nobody finished — a process that died between claiming and posting
     *  — goes stale so a later connect may take it over instead of the greeting
     *  being stranded forever. */
    async claimHello(
      agentId: string,
      teamId: string,
      dmChannelId: string,
    ): Promise<boolean> {
      const claimed = await db
        .update(slackDmBridges)
        .set({ helloClaimedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(slackDmBridges.agentId, agentId),
            eq(slackDmBridges.teamId, teamId),
            eq(slackDmBridges.dmChannelId, dmChannelId),
            eq(slackDmBridges.state, "active"),
            sql`${slackDmBridges.helloPostedAt} is null`,
            sql`(${slackDmBridges.helloClaimedAt} is null or ${slackDmBridges.helloClaimedAt} < now() - interval '5 minutes')`,
          ),
        )
        .returning({ agentId: slackDmBridges.agentId });
      return claimed.length > 0;
    },

    async recordHello(
      agentId: string,
      teamId: string,
      dmChannelId: string,
    ): Promise<void> {
      await db
        .update(slackDmBridges)
        .set({
          helloPostedAt: sql`now()`,
          helloClaimedAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(slackDmBridges.agentId, agentId),
            eq(slackDmBridges.teamId, teamId),
            eq(slackDmBridges.dmChannelId, dmChannelId),
          ),
        );
    },

    /** UNIT_BOUNDARY_DESCRIPTION: give the claim back only when Slack certainly
     *  did not take the greeting — a refused or unreachable call. An answer
     *  nobody saw is left claimed, so the next attempt waits for the claim to
     *  go stale rather than risk posting the greeting twice. */
    async releaseHello(
      agentId: string,
      teamId: string,
      dmChannelId: string,
    ): Promise<void> {
      await db
        .update(slackDmBridges)
        .set({ helloClaimedAt: null, updatedAt: sql`now()` })
        .where(
          and(
            eq(slackDmBridges.agentId, agentId),
            eq(slackDmBridges.teamId, teamId),
            eq(slackDmBridges.dmChannelId, dmChannelId),
          ),
        );
    },

    /** UNIT_BOUNDARY_DESCRIPTION: a plain rebind of an Agent into a DM the
     *  Bridge released reopens that record, so a person who runs the ordinary
     *  bind command is not left with a binding nothing will admit. */
    async reopenChannel(agentId: string, channelId: string): Promise<void> {
      await db
        .update(slackDmBridges)
        .set({
          state: "active",
          generation: sql`${slackDmBridges.generation} + 1`,
          helloPostedAt: null,
          helloClaimedAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(slackDmBridges.agentId, agentId),
            eq(slackDmBridges.dmChannelId, channelId),
            sql`${slackDmBridges.state} <> 'active'`,
          ),
        );
    },

    /** UNIT_BOUNDARY_DESCRIPTION: the binding release a revoke needs, scoped by
     *  the workspace it was proven in, so a conversation id two workspaces
     *  share loses only its own row. */
    async releaseBinding(
      agentId: string,
      teamId: string,
      dmChannelId: string,
    ): Promise<void> {
      await db
        .delete(channels)
        .where(
          and(
            eq(channels.agentId, agentId),
            slackBindingInConversation(teamId, dmChannelId),
          ),
        );
    },

    async bindingsInConversation(
      teamId: string,
      dmChannelId: string,
    ): Promise<{ agentId: string; owner: string }[]> {
      const rows = await db
        .select({ agentId: channels.agentId, owner: channels.owner })
        .from(channels)
        .where(slackBindingInConversation(teamId, dmChannelId));
      return rows;
    },
  };
}

class LinkedElsewhere extends Error {
  constructor(
    readonly code: "linked-to-another-account" | "linked-to-another-workspace",
    readonly link: SlackDmLink,
  ) {
    super(code);
  }
}

export type SlackDmBridgesRepository = ReturnType<
  typeof createSlackDmBridgesRepository
>;
