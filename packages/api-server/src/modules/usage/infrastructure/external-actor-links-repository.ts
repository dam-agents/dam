import { externalActorLinks, identityLinks, sql, type Db } from "db";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";

export type ExternalActorLink = {
  provider: string;
  externalUserId: string;
  keycloakSub: string;
};

export function upsertExternalActorLinks(db: Db, pseudo: SubPseudonymizer) {
  return async (links: ReadonlyArray<ExternalActorLink>): Promise<void> => {
    if (links.length === 0) return;
    await db
      .insert(externalActorLinks)
      .values(
        links.map((l) => ({
          provider: l.provider,
          externalActorHash: pseudo.hashSub(l.externalUserId),
          actorSub: pseudo.hashSub(l.keycloakSub),
        })),
      )
      .onConflictDoUpdate({
        target: [externalActorLinks.provider, externalActorLinks.externalActorHash],
        set: { actorSub: sql`excluded.actor_sub` },
        setWhere: sql`${externalActorLinks.actorSub} IS DISTINCT FROM excluded.actor_sub`,
      });
  };
}

export function listIdentityLinks(db: Db) {
  return async (): Promise<ExternalActorLink[]> =>
    db
      .select({
        provider: identityLinks.provider,
        externalUserId: identityLinks.externalUserId,
        keycloakSub: identityLinks.keycloakSub,
      })
      .from(identityLinks);
}
