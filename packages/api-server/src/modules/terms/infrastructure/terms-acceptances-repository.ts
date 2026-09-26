import type { Db } from "db";
import { termsAcceptances, eq, and, desc } from "db";
import type { AcceptedAcceptance } from "api-server-api";

export interface TermsAcceptancesRepository {
  recordAcceptance(sub: string, version: string, hash: string): Promise<void>;
  findLatest(sub: string): Promise<AcceptedAcceptance | null>;
  findForVersion(
    sub: string,
    version: string,
  ): Promise<AcceptedAcceptance | null>;
}

const acceptanceColumns = {
  version: termsAcceptances.version,
  hash: termsAcceptances.hash,
  acceptedAt: termsAcceptances.acceptedAt,
};

export function createTermsAcceptancesRepository(
  db: Db,
): TermsAcceptancesRepository {
  return {
    async recordAcceptance(sub, version, hash) {
      await db
        .insert(termsAcceptances)
        .values({ sub, version, hash })
        .onConflictDoNothing({
          target: [termsAcceptances.sub, termsAcceptances.version],
        });
    },

    async findLatest(sub) {
      const rows = await db
        .select(acceptanceColumns)
        .from(termsAcceptances)
        .where(eq(termsAcceptances.sub, sub))
        .orderBy(desc(termsAcceptances.acceptedAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async findForVersion(sub, version) {
      const rows = await db
        .select(acceptanceColumns)
        .from(termsAcceptances)
        .where(
          and(
            eq(termsAcceptances.sub, sub),
            eq(termsAcceptances.version, version),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
