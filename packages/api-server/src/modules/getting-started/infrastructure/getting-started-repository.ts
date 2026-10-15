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
  unlock(
    owner: string,
    task: GettingStartedTask,
    choose: (
      taken: ReadonlySet<AvatarCharacter>,
    ) => { character: AvatarCharacter; picked: boolean } | null,
  ): Promise<Unlock | null>;
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

    async unlock(owner, task, choose) {
      return db.transaction(async (tx) => {
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
          })
          .returning();
        await tx
          .update(gettingStartedChecklists)
          .set({ dismissedAt: null })
          .where(eq(gettingStartedChecklists.owner, owner));
        return inserted ? parseUnlock(inserted) : null;
      });
    },

    async markSeen(owner, task) {
      await db
        .update(avatarUnlocks)
        .set({ seenAt: sql`now()` })
        .where(
          and(
            eq(avatarUnlocks.owner, owner),
            eq(avatarUnlocks.task, task),
            isNull(avatarUnlocks.seenAt),
          ),
        );
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

    async reset(owner) {
      await db.transaction(async (tx) => {
        await tx.delete(avatarUnlocks).where(eq(avatarUnlocks.owner, owner));
        await tx
          .update(gettingStartedChecklists)
          .set({ dismissedAt: null })
          .where(eq(gettingStartedChecklists.owner, owner));
      });
    },
  };
}
