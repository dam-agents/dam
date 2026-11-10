import type { Db } from "db";
import { identityLinks, eq, and, asc, sql, slackDmBridges } from "db";
import { securityLog } from "../../../core/security-log.js";
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
 * it overwrites whatever an email pairing guessed. When it moves that Slack
 * user to another owner — or another workspace — the previous owner's Bridge
 * records for that person are closed in the same transaction, before the
 * replacement is visible: otherwise the DM the pairing bound would keep reaching
 * the previous owner's Agent and its key. A sign-in by the same owner only
 * promotes the link and leaves the Bridge working.
 */
export function upsertIdentityLink(db: Db) {
  return async (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    teamId?: string,
  ): Promise<void> => {
    await db.transaction(async (tx) => {
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
          .for("update")
      )[0];
      const reassigned =
        previous !== undefined &&
        (previous.keycloakSub !== keycloakSub ||
          (teamId !== undefined && previous.teamId !== teamId));
      if (reassigned) {
        await tx
          .update(slackDmBridges)
          .set({ state: "revoking", updatedAt: sql`now()` })
          .where(
            and(
              eq(slackDmBridges.ownerSub, previous!.keycloakSub),
              eq(slackDmBridges.slackUserId, externalUserId),
              sql`${slackDmBridges.state} <> 'revoked'`,
            ),
          );
        securityLog("warn", "identity.link.reassigned", {
          category: "channel",
          actor: keycloakSub,
          actorKind: "user",
          surface: "slack",
          decision: "deny",
          reason: "identity-reassigned",
          detail: { previousOwner: previous!.keycloakSub },
        });
      }
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
        });
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
