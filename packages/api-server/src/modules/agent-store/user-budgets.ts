import { eq, type Db } from "db";
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
  db: Db,
  ownerSub: string,
): Promise<UserBudgetSizes> {
  return sizesOf(await readUserBudget(db, ownerSub));
}

export async function readUserBudget(
  db: Db,
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
  const from = await readUserBudgetSizes(db, input.ownerSub);
  const existing = await readUserBudget(db, input.ownerSub);
  const next: UserBudgetSizes = {
    cpu: input.change.cpu === undefined ? from.cpu : input.change.cpu,
    memory:
      input.change.memory === undefined ? from.memory : input.change.memory,
    storage:
      input.change.storage === undefined ? from.storage : input.change.storage,
  };

  if (next.cpu === null && next.memory === null && next.storage === null) {
    if (existing) await deleteUserBudget(db, input.ownerSub);
    return { row: null, from: existing ? from : null };
  }

  const values = {
    cpu: next.cpu,
    memory: next.memory,
    storage: next.storage,
    setBySub: input.setBySub,
    operatorUpdatedAt: new Date(),
    updatedAt: new Date(),
  };
  await db
    .insert(controlUserBudgets)
    .values({ ownerSub: input.ownerSub, ...values })
    .onConflictDoUpdate({
      target: controlUserBudgets.ownerSub,
      set: values,
    });
  return { row: await readUserBudget(db, input.ownerSub), from };
}

export async function deleteUserBudget(
  db: Db,
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
