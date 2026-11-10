import type { Db } from "db";
import {
  and,
  channels,
  eq,
  identityLinks,
  slackDmBridges,
  slackOwnedThreads,
  sql,
} from "db";
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
  helloClaimToken: string | null;
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
    helloClaimToken: row.helloClaimToken,
    helloPostedAt: row.helloPostedAt,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one serialization point for a Slack user's
 * link and Bridge state. Every write below takes it first, in one fixed order —
 * this advisory lock, then `identity_links`, then `slack_dm_bridges`, then
 * `channels`, then `slack_owned_threads` — so writers cannot deadlock against
 * each other and, more importantly, so the lock exists even when the identity
 * row does not yet: a connect that inserts the first link and a sign-in that
 * confirms a different owner then serialize instead of one of them reading an
 * absence and skipping the retirement the other needed.
 */
export async function lockSlackDm(
  tx: Tx,
  teamId: string,
  slackUserId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`slack-dm:${teamId}:${slackUserId}`}, 0))`,
  );
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
        await lockSlackDm(t, input.teamId, input.slackUserId);
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

        /* UNIT_BOUNDARY_DESCRIPTION: whatever this person's other records say,
         * only the identity just settled here may keep one: a record settled by
         * an owner or workspace that no longer holds the link is retired in the
         * same transaction, so a disproved pairing cannot stay open. */
        await t
          .update(slackDmBridges)
          .set({ state: "revoking", updatedAt: sql`now()` })
          .where(
            and(
              eq(slackDmBridges.slackUserId, input.slackUserId),
              sql`(${slackDmBridges.ownerSub} <> ${input.ownerSub} or ${slackDmBridges.teamId} <> ${input.teamId})`,
              sql`${slackDmBridges.state} <> 'revoked'`,
            ),
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

  /**
   * UNIT_BOUNDARY_DESCRIPTION: Release one recorded pairing in one transaction
   * under the user's lock: the generation this revoke was read from is checked,
   * every delete runs while nothing else can write, and only then is the record
   * marked. A revoke that started before a reconnect therefore deletes nothing
   * at all, and a failed transaction leaves the record exactly as it was, so
   * nobody reports a closure or a cleanup that did not happen.
   */
  async function revokeBridge(input: {
    agentId: string;
    teamId: string;
    dmChannelId: string;
    slackUserId: string;
    ownerSub: string;
    generation: number;
  }): Promise<
    | { outcome: "revoked"; threadsReleased: number; linksRemoved: number }
    | { outcome: "superseded" | "absent" }
  > {
    return tx(async (t) => {
      await lockSlackDm(t, input.teamId, input.slackUserId);
      const record = (
        await t
          .select()
          .from(slackDmBridges)
          .where(
            and(
              eq(slackDmBridges.agentId, input.agentId),
              eq(slackDmBridges.teamId, input.teamId),
              eq(slackDmBridges.dmChannelId, input.dmChannelId),
            ),
          )
          .limit(1)
          .for("update")
      )[0];
      if (!record) return { outcome: "absent" as const };
      if (record.generation !== input.generation || record.state === "revoked")
        return { outcome: "superseded" as const };

      await t
        .update(slackDmBridges)
        .set({ state: "revoking", updatedAt: sql`now()` })
        .where(
          and(
            eq(slackDmBridges.agentId, input.agentId),
            eq(slackDmBridges.teamId, input.teamId),
            eq(slackDmBridges.dmChannelId, input.dmChannelId),
          ),
        );
      await t
        .delete(channels)
        .where(
          and(
            eq(channels.agentId, input.agentId),
            slackBindingInConversation(input.teamId, input.dmChannelId),
          ),
        );
      const threads = await t
        .delete(slackOwnedThreads)
        .where(
          and(
            eq(slackOwnedThreads.agentId, input.agentId),
            eq(slackOwnedThreads.channelId, input.dmChannelId),
            eq(slackOwnedThreads.teamId, input.teamId),
          ),
        )
        .returning({ threadTs: slackOwnedThreads.threadTs });
      const left = await t
        .select({ agentId: channels.agentId })
        .from(channels)
        .where(slackBindingInConversation(input.teamId, input.dmChannelId));
      const links =
        left.length === 0
          ? await t
              .delete(identityLinks)
              .where(
                and(
                  eq(identityLinks.provider, "slack"),
                  eq(identityLinks.externalUserId, input.slackUserId),
                  eq(identityLinks.source, "email"),
                  eq(identityLinks.teamId, input.teamId),
                  eq(identityLinks.keycloakSub, input.ownerSub),
                ),
              )
              .returning({ externalUserId: identityLinks.externalUserId })
          : [];
      await t
        .update(slackDmBridges)
        .set({ state: "revoked", updatedAt: sql`now()` })
        .where(
          and(
            eq(slackDmBridges.agentId, input.agentId),
            eq(slackDmBridges.teamId, input.teamId),
            eq(slackDmBridges.dmChannelId, input.dmChannelId),
          ),
        );
      return {
        outcome: "revoked" as const,
        threadsReleased: threads.length,
        linksRemoved: links.length,
      };
    });
  }

  return {
    settleConnect,
    revokeBridge,

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

    async closedFor(
      agentId: string,
      channelId: string,
    ): Promise<{ teamId: string; dmChannelId: string }[]> {
      const rows = await db
        .select({
          teamId: slackDmBridges.teamId,
          dmChannelId: slackDmBridges.dmChannelId,
        })
        .from(slackDmBridges)
        .where(
          and(
            eq(slackDmBridges.agentId, agentId),
            eq(slackDmBridges.dmChannelId, channelId),
            sql`${slackDmBridges.state} <> 'active'`,
          ),
        );
      return rows;
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

    /** UNIT_BOUNDARY_DESCRIPTION: the greeting is claimed, recorded and
     *  released under the user's lock and owned by the token the claim returns,
     *  so exactly one attempt may finish: a claim taken over after going stale
     *  leaves the earlier sender unable to record or release anything, and a
     *  reconnect's fresh generation cannot have its greeting bookkeeping
     *  overwritten by the attempt it superseded. */
    async claimHello(
      agentId: string,
      teamId: string,
      dmChannelId: string,
      slackUserId: string,
    ): Promise<string | null> {
      return tx(async (t) => {
        await lockSlackDm(t, teamId, slackUserId);
        const token = crypto.randomUUID();
        const claimed = await t
          .update(slackDmBridges)
          .set({
            helloClaimedAt: sql`now()`,
            helloClaimToken: token,
            updatedAt: sql`now()`,
          })
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
        return claimed.length > 0 ? token : null;
      });
    },

    async recordHello(
      agentId: string,
      teamId: string,
      dmChannelId: string,
      slackUserId: string,
      token: string,
    ): Promise<boolean> {
      return tx(async (t) => {
        await lockSlackDm(t, teamId, slackUserId);
        const recorded = await t
          .update(slackDmBridges)
          .set({
            helloPostedAt: sql`now()`,
            helloClaimedAt: null,
            helloClaimToken: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(slackDmBridges.agentId, agentId),
              eq(slackDmBridges.teamId, teamId),
              eq(slackDmBridges.dmChannelId, dmChannelId),
              eq(slackDmBridges.helloClaimToken, token),
            ),
          )
          .returning({ agentId: slackDmBridges.agentId });
        return recorded.length > 0;
      });
    },

    async releaseHello(
      agentId: string,
      teamId: string,
      dmChannelId: string,
      slackUserId: string,
      token: string,
    ): Promise<boolean> {
      return tx(async (t) => {
        await lockSlackDm(t, teamId, slackUserId);
        const released = await t
          .update(slackDmBridges)
          .set({
            helloClaimedAt: null,
            helloClaimToken: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(slackDmBridges.agentId, agentId),
              eq(slackDmBridges.teamId, teamId),
              eq(slackDmBridges.dmChannelId, dmChannelId),
              eq(slackDmBridges.helloClaimToken, token),
              sql`${slackDmBridges.helloPostedAt} is null`,
            ),
          )
          .returning({ agentId: slackDmBridges.agentId });
        return released.length > 0;
      });
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
