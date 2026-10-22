import { eq, sql, spendCeilings, type Db } from "db";
import type { SpendCeiling } from "../domain/limits.js";

export interface SpendCeilings {
  forOwner(ownerSub: string): Promise<SpendCeiling | null>;
}

export interface SpendCeilingRow {
  readonly ownerSub: string;
  readonly amountMicros: number;
  readonly setBySub: string;
  readonly updatedAt: Date;
}

export interface SpendCeilingStore extends SpendCeilings {
  list(): Promise<SpendCeilingRow[]>;
  has(ownerSub: string): Promise<boolean>;
  upsert(input: {
    ownerSub: string;
    amountMicros: number;
    setBySub: string;
  }): Promise<{ row: SpendCeilingRow; fromMicros: number | null }>;
  clear(ownerSub: string): Promise<number | null>;
}

const ROW_COLUMNS = {
  ownerSub: spendCeilings.ownerSub,
  amountMicros: spendCeilings.amountMicros,
  setBySub: spendCeilings.setBySub,
  updatedAt: spendCeilings.updatedAt,
};

export function createSpendCeilingStore(deps: {
  db: Db;
  defaultMicros: number | null;
}): SpendCeilingStore {
  const { db } = deps;
  return {
    async forOwner(ownerSub) {
      const [row] = await db
        .select({ amountMicros: spendCeilings.amountMicros })
        .from(spendCeilings)
        .where(eq(spendCeilings.ownerSub, ownerSub));
      if (row) return { amountMicros: row.amountMicros, source: "operator" };
      return deps.defaultMicros === null
        ? null
        : { amountMicros: deps.defaultMicros, source: "default" };
    },

    list() {
      return db.select(ROW_COLUMNS).from(spendCeilings);
    },

    async has(ownerSub) {
      const [row] = await db
        .select({ ownerSub: spendCeilings.ownerSub })
        .from(spendCeilings)
        .where(eq(spendCeilings.ownerSub, ownerSub));
      return row !== undefined;
    },

    upsert({ ownerSub, amountMicros, setBySub }) {
      return db.transaction(async (tx) => {
        const [before] = await tx
          .select({ amountMicros: spendCeilings.amountMicros })
          .from(spendCeilings)
          .where(eq(spendCeilings.ownerSub, ownerSub))
          .for("update");
        const [row] = await tx
          .insert(spendCeilings)
          .values({ ownerSub, amountMicros, setBySub })
          .onConflictDoUpdate({
            target: spendCeilings.ownerSub,
            set: { amountMicros, setBySub, updatedAt: sql`now()` },
          })
          .returning(ROW_COLUMNS);
        return { row: row!, fromMicros: before?.amountMicros ?? null };
      });
    },

    async clear(ownerSub) {
      const [row] = await db
        .delete(spendCeilings)
        .where(eq(spendCeilings.ownerSub, ownerSub))
        .returning({ amountMicros: spendCeilings.amountMicros });
      return row?.amountMicros ?? null;
    },
  };
}
