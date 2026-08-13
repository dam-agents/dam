import crypto from "node:crypto";
import type { Db } from "db";
import { skillSets, and, eq } from "db";
import type { SkillSet, SkillSetEntry } from "api-server-api";
import { skillSetEntrySchema } from "api-server-api";
import { z } from "zod";
import { getLogger } from "../../../core/logger.js";

export type SkillSetRow = SkillSet & { entriesUnreadable?: true };

export interface SkillSetsRepository {
  list(owner: string): Promise<SkillSetRow[]>;
  get(id: string, owner: string): Promise<SkillSetRow | null>;
  create(
    input: { name: string; skills: SkillSetEntry[] },
    owner: string,
  ): Promise<SkillSet>;
  delete(id: string, owner: string): Promise<void>;
}

function generateId(): string {
  return `skill-set-${crypto.randomBytes(4).toString("hex")}`;
}

const entriesSchema = z.array(skillSetEntrySchema);

function rowToSet(r: {
  id: string;
  name: string;
  skills: unknown;
  createdAt: Date;
}): SkillSetRow {
  const parsed = entriesSchema.safeParse(r.skills);
  if (!parsed.success) {
    getLogger().error(
      { setId: r.id, err: parsed.error },
      "skill set entries unparseable; serving it as empty",
    );
  }
  return {
    id: r.id,
    name: r.name,
    skills: parsed.success ? parsed.data : [],
    createdAt: r.createdAt.toISOString(),
    ...(parsed.success ? {} : { entriesUnreadable: true as const }),
  };
}

export function createSkillSetsRepository(db: Db): SkillSetsRepository {
  return {
    async list(owner) {
      const rows = await db
        .select()
        .from(skillSets)
        .where(eq(skillSets.owner, owner));
      return rows.map(rowToSet).sort((a, b) => a.name.localeCompare(b.name));
    },

    async get(id, owner) {
      const rows = await db
        .select()
        .from(skillSets)
        .where(and(eq(skillSets.id, id), eq(skillSets.owner, owner)));
      const row = rows[0];
      return row ? rowToSet(row) : null;
    },

    async create(input, owner) {
      const id = generateId();
      const rows = await db
        .insert(skillSets)
        .values({ id, owner, name: input.name, skills: input.skills })
        .returning();
      return rowToSet(rows[0]!);
    },

    async delete(id, owner) {
      await db
        .delete(skillSets)
        .where(and(eq(skillSets.id, id), eq(skillSets.owner, owner)));
    },
  };
}
