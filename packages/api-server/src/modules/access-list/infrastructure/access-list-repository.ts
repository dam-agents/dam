import { accessList, asc, type Db, eq } from "db";

export interface StoredAccessEntry {
  email: string;
  addedAt: string;
}

export interface AccessListRepository {
  list(): Promise<StoredAccessEntry[]>;
  has(email: string): Promise<boolean>;
  add(emails: readonly string[], addedBy: string | null): Promise<number>;
  remove(email: string): Promise<boolean>;
}

// UNIT_BOUNDARY_DESCRIPTION: the install's Access List in Postgres, one row per lowercased email, read in address order. Adding an address already on the list keeps its first row, so a repeated seed or a second add changes nothing.
export function createAccessListRepository(db: Db): AccessListRepository {
  return {
    async list() {
      const rows = await db
        .select()
        .from(accessList)
        .orderBy(asc(accessList.email));
      return rows.map((row) => ({
        email: row.email,
        addedAt: row.addedAt.toISOString(),
      }));
    },
    async has(email) {
      const rows = await db
        .select({ email: accessList.email })
        .from(accessList)
        .where(eq(accessList.email, email))
        .limit(1);
      return rows.length > 0;
    },
    async add(emails, addedBy) {
      if (emails.length === 0) return 0;
      const added = await db
        .insert(accessList)
        .values(emails.map((email) => ({ email, addedBy })))
        .onConflictDoNothing()
        .returning({ email: accessList.email });
      return added.length;
    },
    async remove(email) {
      const removed = await db
        .delete(accessList)
        .where(eq(accessList.email, email))
        .returning({ email: accessList.email });
      return removed.length > 0;
    },
  };
}
