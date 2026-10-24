import { eq, type Db, type DbTx } from "db";
import { controlUserBudgets } from "db";
import type {
  UserBudgetChange,
  UserBudgetRow,
  UserBudgetSizes,
} from "../budgets/infrastructure/user-budgets.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the operator's user budgets, over the rows that
 * hold them instead of the custom resource.
 *
 * The contract is the one the resource had: a field set to a value, a field set
 * to null to inherit the chart's again, a field left out kept, and a budget with
 * no field left deleted rather than stored as a row that repeats the defaults.
 * Who wrote it and when are columns, so a budget written outside the platform
 * carries neither and reads as set outside it.
 */
export async function readUserBudgetSizes(
  db: Db | DbTx,
  ownerSub: string,
): Promise<UserBudgetSizes> {
  return sizesOf(await readUserBudget(db, ownerSub));
}

export async function readUserBudget(
  db: Db | DbTx,
  ownerSub: string,
): Promise<UserBudgetRow | null> {
  const rows = await db
    .select()
    .from(controlUserBudgets)
    .where(eq(controlUserBudgets.ownerSub, ownerSub))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ownerSub: row.ownerSub,
    cpu: row.cpu,
    memory: row.memory,
    storage: row.storage,
    setBySub: row.setBySub,
    updatedAt: row.operatorUpdatedAt?.toISOString() ?? null,
  };
}

export async function listUserBudgets(db: Db): Promise<UserBudgetRow[]> {
  const rows = await db.select().from(controlUserBudgets);
  return rows.map((row) => ({
    ownerSub: row.ownerSub,
    cpu: row.cpu,
    memory: row.memory,
    storage: row.storage,
    setBySub: row.setBySub,
    updatedAt: row.operatorUpdatedAt?.toISOString() ?? null,
  }));
}

export async function writeUserBudget(
  db: Db,
  input: { ownerSub: string; change: UserBudgetChange; setBySub: string },
): Promise<{ row: UserBudgetRow | null; from: UserBudgetSizes | null }> {
  return db.transaction(async (tx) => {
    const before = await readUserBudget(tx, input.ownerSub);
    const from = sizesOf(before);
    const set: Record<string, unknown> = {
      setBySub: input.setBySub,
      operatorUpdatedAt: new Date(),
      updatedAt: new Date(),
    };
    if (input.change.cpu !== undefined) set.cpu = input.change.cpu;
    if (input.change.memory !== undefined) set.memory = input.change.memory;
    if (input.change.storage !== undefined) set.storage = input.change.storage;
    const next = {
      cpu: input.change.cpu === undefined ? from.cpu : input.change.cpu,
      memory:
        input.change.memory === undefined ? from.memory : input.change.memory,
      storage:
        input.change.storage === undefined
          ? from.storage
          : input.change.storage,
    };

    if (next.cpu === null && next.memory === null && next.storage === null) {
      if (before === null) return { row: null, from: null };
      await tx
        .delete(controlUserBudgets)
        .where(eq(controlUserBudgets.ownerSub, input.ownerSub));
      return { row: null, from };
    }

    await tx
      .insert(controlUserBudgets)
      .values({ ownerSub: input.ownerSub, ...set })
      .onConflictDoUpdate({
        target: controlUserBudgets.ownerSub,
        set,
      });
    return {
      row: await readUserBudget(tx, input.ownerSub),
      from: before === null ? null : from,
    };
  });
}

export async function deleteUserBudget(
  db: Db | DbTx,
  ownerSub: string,
): Promise<UserBudgetSizes | null> {
  const before = await readUserBudget(db, ownerSub);
  if (!before) return null;
  await db
    .delete(controlUserBudgets)
    .where(eq(controlUserBudgets.ownerSub, ownerSub));
  return sizesOf(before);
}

function sizesOf(row: UserBudgetRow | null): UserBudgetSizes {
  return {
    cpu: row?.cpu ?? null,
    memory: row?.memory ?? null,
    storage: row?.storage ?? null,
  };
}
