import type { Db } from "db";
import { identityLinks, eq, and } from "db";

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

export function findExternalLinksByIdentity(db: Db) {
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
    ).map((row) => ({ ...row, source: toSource(row.source) }));
}

/** UNIT_BOUNDARY_DESCRIPTION: A pairing that only found the mailbox inserts and
 *  nothing more: an existing row belongs to whoever proved it, and moving it
 *  would hand them someone else's account. */
export function insertEmailIdentityLinkIfAbsent(db: Db) {
  return async (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    teamId?: string,
  ): Promise<void> => {
    await db
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
      });
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: a pairing is a workspace's mailbox, so the
 *  revoke names that workspace: an owner paired in two trusted workspaces keeps
 *  the other one. */
export function deleteEmailIdentityLinksOfSub(db: Db) {
  return async (
    provider: string,
    keycloakSub: string,
    teamId?: string,
  ): Promise<number> => {
    const removed = await db
      .delete(identityLinks)
      .where(
        and(
          eq(identityLinks.provider, provider),
          eq(identityLinks.keycloakSub, keycloakSub),
          eq(identityLinks.source, "email"),
          teamId === undefined ? undefined : eq(identityLinks.teamId, teamId),
        ),
      )
      .returning({ externalUserId: identityLinks.externalUserId });
    return removed.length;
  };
}

export function upsertIdentityLink(db: Db) {
  return async (
    provider: string,
    externalUserId: string,
    keycloakSub: string,
    teamId?: string,
  ): Promise<void> => {
    await db
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
