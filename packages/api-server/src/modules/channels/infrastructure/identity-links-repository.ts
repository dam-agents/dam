import type { Db } from "db";
import { identityLinks, eq, and, asc, sql, slackDmBridges } from "db";
import { securityLog } from "../../../core/security-log.js";
import { lockSlackDm } from "./slack-dm-bridges-repository.js";
import type { Tx } from "../../../core/unit-of-work.js";

export type IdentityLinkSource = "oauth" | "email";

export interface IdentityLink {
  provider: string;
  externalUserId: string;
  keycloakSub: string;
  source: IdentityLinkSource;
}

export function findIdentityByExternalUser(db: Db) {
  return async (
    provider: string,
    externalUserId: string,
  ): Promise<IdentityLink | null> => {
    const rows = await db
      .select()
      .from(identityLinks)
      .where(
        and(
          eq(identityLinks.provider, provider),
          eq(identityLinks.externalUserId, externalUserId),
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    return {
      provider: rows[0].provider,
      externalUserId: rows[0].externalUserId,
      keycloakSub: rows[0].keycloakSub,
      source: toSource(rows[0].source),
    };
  };
}

function toSource(value: string): IdentityLinkSource {
  return value === "email" ? "email" : "oauth";
}

export function findExternalUsersByIdentity(db: Db) {
  return async (provider: string, keycloakSub: string): Promise<string[]> => {
    const rows = await db
      .select({ externalUserId: identityLinks.externalUserId })
      .from(identityLinks)
      .where(
        and(
          eq(identityLinks.provider, provider),
          eq(identityLinks.keycloakSub, keycloakSub),
        ),
      );
    return rows.map((r) => r.externalUserId);
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: an owner's links in a stable order, the workspace
 *  one before a legacy link that recorded none, so a destination chosen from
 *  them is the same one on every read. */
export function findExternalLinksByIdentity(db: Db | Tx) {
  return async (
    provider: string,
    keycloakSub: string,
  ): Promise<
    {
      externalUserId: string;
      teamId: string | null;
      source: IdentityLinkSource;
    }[]
  > =>
    (
      await db
        .select({
          externalUserId: identityLinks.externalUserId,
          teamId: identityLinks.teamId,
          source: identityLinks.source,
        })
        .from(identityLinks)
        .where(
          and(
            eq(identityLinks.provider, provider),
            eq(identityLinks.keycloakSub, keycloakSub),
          ),
        )
        .orderBy(
          sql`${identityLinks.teamId} is null`,
          asc(identityLinks.teamId),
          asc(identityLinks.externalUserId),
        )
    ).map((row) => ({ ...row, source: toSource(row.source) }));
}

/** UNIT_BOUNDARY_DESCRIPTION: A pairing that only found the mailbox inserts and
 *  nothing more: an existing row belongs to whoever proved it, and moving it
 *  would hand them someone else's account. It answers whether this call was the
 *  one that created the row, so only that call reports the link it made. */
export function insertEmailIdentityLinkIfAbsent(db: Db | Tx) {
  return async (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    teamId?: string,
  ): Promise<boolean> => {
    const inserted = await db
      .insert(identityLinks)
      .values({
        provider,
        externalUserId,
        keycloakSub,
        teamId,
        source: "email",
      })
      .onConflictDoNothing({
        target: [identityLinks.provider, identityLinks.externalUserId],
      })
      .returning({ externalUserId: identityLinks.externalUserId });
    return inserted.length > 0;
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: a revoke names the one person whose DM it released
 *  and the workspace that DM is in, so an owner paired in two workspaces, or
 *  paired twice in one, keeps every link the released DM did not use. */
export function deleteEmailIdentityLink(db: Db | Tx) {
  return async (
    provider: string,
    externalUserId: string,
    teamId: string,
    expectedOwnerSub: string,
  ): Promise<number> => {
    const removed = await db
      .delete(identityLinks)
      .where(
        and(
          eq(identityLinks.provider, provider),
          eq(identityLinks.externalUserId, externalUserId),
          eq(identityLinks.source, "email"),
          eq(identityLinks.teamId, teamId),
          eq(identityLinks.keycloakSub, expectedOwnerSub),
        ),
      )
      .returning({ externalUserId: identityLinks.externalUserId });
    return removed.length;
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A Keycloak sign-in proves who a Slack user is, and
 * it overwrites whatever an email pairing guessed. It runs under the same
 * serialization every Bridge write takes — the advisory lock on the workspace
 * and the Slack user, which exists even before the row does — so a connect that
 * inserts the first link and a sign-in that proves another owner cannot each
 * read their own moment and skip the other's work.
 *
 * Under that lock the identity it settled is read back and every Bridge record
 * of the person that does not match it is retired in the same transaction:
 * whatever a pairing bound for a previous owner, or in another workspace, stops
 * admitting turns before the replacement is visible. A sign-in by the same
 * owner only promotes the link and leaves the Bridge working.
 */
export function upsertIdentityLink(db: Db) {
  return async (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    teamId?: string,
  ): Promise<void> => {
    await db.transaction(async (tx) => {
      if (provider === "slack") {
        await lockSlackDm(tx, teamId ?? "", externalUserId);
        const previous = (
          await tx
            .select({
              keycloakSub: identityLinks.keycloakSub,
              teamId: identityLinks.teamId,
            })
            .from(identityLinks)
            .where(
              and(
                eq(identityLinks.provider, provider),
                eq(identityLinks.externalUserId, externalUserId),
              ),
            )
            .limit(1)
        )[0];
        if (
          previous !== undefined &&
          (previous.keycloakSub !== keycloakSub ||
            (teamId !== undefined && previous.teamId !== teamId))
        )
          securityLog("warn", "identity.link.reassigned", {
            category: "channel",
            actor: keycloakSub,
            actorKind: "user",
            surface: "slack",
            decision: "deny",
            reason: "identity-reassigned",
            detail: { previousOwner: previous.keycloakSub },
          });
      }
      const settled = (
        await tx
          .insert(identityLinks)
          .values({
            provider,
            externalUserId,
            keycloakSub,
            teamId,
            source: "oauth",
          })
          .onConflictDoUpdate({
            target: [identityLinks.provider, identityLinks.externalUserId],
            set:
              teamId === undefined
                ? { keycloakSub, source: "oauth" }
                : { keycloakSub, teamId, source: "oauth" },
          })
          .returning({
            keycloakSub: identityLinks.keycloakSub,
            teamId: identityLinks.teamId,
          })
      )[0];
      if (provider !== "slack" || settled === undefined) return;
      await tx
        .update(slackDmBridges)
        .set({ state: "revoking", updatedAt: sql`now()` })
        .where(
          and(
            eq(slackDmBridges.slackUserId, externalUserId),
            sql`(${slackDmBridges.ownerSub} <> ${settled.keycloakSub} or ${slackDmBridges.teamId} is distinct from ${settled.teamId})`,
            sql`${slackDmBridges.state} <> 'revoked'`,
          ),
        );
    });
  };
}

export function deleteIdentityLink(db: Db) {
  return async (provider: string, externalUserId: string): Promise<void> => {
    await db
      .delete(identityLinks)
      .where(
        and(
          eq(identityLinks.provider, provider),
          eq(identityLinks.externalUserId, externalUserId),
        ),
      );
  };
}
