import {
  type AvatarCharacter,
  isAvatarCharacter,
} from "api-server-api/avatar/svg";
import {
  gettingStartedTaskSchema,
  type GettingStartedTask,
} from "api-server-api";
import {
  and,
  avatarUnlocks,
  eq,
  gettingStartedChecklists,
  isNull,
  sql,
  type Db,
  type DbTx,
} from "db";

import type { Checklist, Unlock } from "../domain/unlocks.js";

export interface GettingStartedRepository {
  find(owner: string): Promise<Checklist | null>;
  enroll(
    owner: string,
    unlocked: ReadonlyArray<{
      task: GettingStartedTask;
      character: AvatarCharacter;
    }>,
  ): Promise<void>;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: records the task's unlock, unless it is already
   * recorded. `seen` writes it already seen, in the same statement: a task the
   * platform reports for the person is counted, never announced, so no unseen hint
   * and no celebration goes out for it.
   */
  unlock(
    owner: string,
    task: GettingStartedTask,
    choose: (
      taken: ReadonlySet<AvatarCharacter>,
    ) => { character: AvatarCharacter; picked: boolean } | null,
    opts?: { seen: boolean },
  ): Promise<Unlock | null>;
  /* UNIT_BOUNDARY_DESCRIPTION: the checklist's own reads and writes, as one transaction of the caller's sees them — so a caller that holds a lock and a transaction can keep the checklist inside them. */
  unlockIn(
    tx: DbTx,
    owner: string,
    task: GettingStartedTask,
    choose: (
      taken: ReadonlySet<AvatarCharacter>,
    ) => { character: AvatarCharacter; picked: boolean } | null,
    opts?: { seen: boolean },
  ): Promise<Unlock | null>;
  markSeenIn(tx: DbTx, owner: string, task: GettingStartedTask): Promise<void>;
  resetIn(tx: DbTx, owner: string): Promise<void>;
  markSeen(owner: string, task: GettingStartedTask): Promise<void>;
  markPicked(owner: string, character: AvatarCharacter): Promise<void>;
  setDismissed(owner: string, dismissed: boolean): Promise<void>;
  reset(owner: string): Promise<void>;
}

type UnlockRow = typeof avatarUnlocks.$inferSelect;

function parseUnlock(row: UnlockRow): Unlock | null {
  const task = gettingStartedTaskSchema.safeParse(row.task);
  if (!task.success || !isAvatarCharacter(row.character)) return null;
  return {
    task: task.data,
    character: row.character,
    unlockedAt: row.unlockedAt,
    seenAt: row.seenAt,
    pickedAt: row.pickedAt,
  };
}

/* UNIT_BOUNDARY_DESCRIPTION: the checklist's unlock write, shared by the caller's own transaction — the assistant's first result holds one — and the standalone path, so both do exactly the same thing. `seen` writes the unlock already seen, in the same statement, so a task the platform reports never carries an unseen hint or a celebration. */
async function unlockIn(
  tx: DbTx,
  owner: string,
  task: GettingStartedTask,
  choose: (
    taken: ReadonlySet<AvatarCharacter>,
  ) => { character: AvatarCharacter; picked: boolean } | null,
  opts?: { seen: boolean },
): Promise<Unlock | null> {
  await tx
    .select({ owner: gettingStartedChecklists.owner })
    .from(gettingStartedChecklists)
    .where(eq(gettingStartedChecklists.owner, owner))
    .for("update");
  const rows = await tx
    .select()
    .from(avatarUnlocks)
    .where(eq(avatarUnlocks.owner, owner));
  if (rows.some((r) => r.task === task)) return null;
  const chosen = choose(
    new Set(rows.map((r) => r.character).filter(isAvatarCharacter)),
  );
  if (!chosen) return null;
  const [inserted] = await tx
    .insert(avatarUnlocks)
    .values({
      owner,
      task,
      character: chosen.character,
      ...(chosen.picked ? { pickedAt: sql`now()` } : {}),
      ...(opts?.seen ? { seenAt: sql`now()` } : {}),
    })
    .returning();
  await tx
    .update(gettingStartedChecklists)
    .set({ dismissedAt: null })
    .where(eq(gettingStartedChecklists.owner, owner));
  return inserted ? parseUnlock(inserted) : null;
}

async function markSeenIn(
  tx: DbTx,
  owner: string,
  task: GettingStartedTask,
): Promise<void> {
  await tx
    .update(avatarUnlocks)
    .set({ seenAt: sql`now()` })
    .where(
      and(
        eq(avatarUnlocks.owner, owner),
        eq(avatarUnlocks.task, task),
        isNull(avatarUnlocks.seenAt),
      ),
    );
}

async function resetIn(tx: DbTx, owner: string): Promise<void> {
  await tx.delete(avatarUnlocks).where(eq(avatarUnlocks.owner, owner));
  await tx
    .update(gettingStartedChecklists)
    .set({ dismissedAt: null })
    .where(eq(gettingStartedChecklists.owner, owner));
}

export function createGettingStartedRepository(
  db: Db,
): GettingStartedRepository {
  return {
    async find(owner) {
      const [checklist] = await db
        .select({ dismissedAt: gettingStartedChecklists.dismissedAt })
        .from(gettingStartedChecklists)
        .where(eq(gettingStartedChecklists.owner, owner));
      if (!checklist) return null;
      const rows = await db
        .select()
        .from(avatarUnlocks)
        .where(eq(avatarUnlocks.owner, owner));
      return {
        dismissedAt: checklist.dismissedAt,
        unlocks: rows.flatMap((r) => parseUnlock(r) ?? []),
      };
    },

    async enroll(owner, unlocked) {
      await db.transaction(async (tx) => {
        const created = await tx
          .insert(gettingStartedChecklists)
          .values({ owner })
          .onConflictDoNothing()
          .returning({ owner: gettingStartedChecklists.owner });
        if (created.length === 0 || unlocked.length === 0) return;
        await tx.insert(avatarUnlocks).values(
          unlocked.map((u) => ({
            owner,
            task: u.task,
            character: u.character,
            seenAt: sql`now()`,
            pickedAt: sql`now()`,
          })),
        );
      });
    },

    unlockIn(tx, owner, task, choose, opts) {
      return unlockIn(tx, owner, task, choose, opts);
    },

    async unlock(owner, task, choose, opts) {
      return db.transaction((tx) => unlockIn(tx, owner, task, choose, opts));
    },

    async markSeen(owner, task) {
      await db.transaction((tx) => markSeenIn(tx, owner, task));
    },

    async markPicked(owner, character) {
      await db
        .update(avatarUnlocks)
        .set({ pickedAt: sql`now()` })
        .where(
          and(
            eq(avatarUnlocks.owner, owner),
            eq(avatarUnlocks.character, character),
            isNull(avatarUnlocks.pickedAt),
          ),
        );
    },

    async setDismissed(owner, dismissed) {
      await db
        .update(gettingStartedChecklists)
        .set({ dismissedAt: dismissed ? sql`now()` : null })
        .where(eq(gettingStartedChecklists.owner, owner));
    },

    markSeenIn: (tx, owner, task) => markSeenIn(tx, owner, task),
    resetIn: (tx, owner) => resetIn(tx, owner),

    async reset(owner) {
      await db.transaction((tx) => resetIn(tx, owner));
    },
  };
}
