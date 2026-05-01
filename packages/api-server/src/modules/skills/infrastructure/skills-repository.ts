import crypto from "node:crypto";
import type { Db } from "db";
import { skillSources, eq, and } from "db";
import type { SkillSource } from "api-server-api";
import type { SkillSourceSeed } from "./seed-sources.js";

export interface SkillsRepository {
  list(owner: string): Promise<SkillSource[]>;
  get(id: string, owner: string): Promise<SkillSource | null>;
  create(input: { name: string; gitUrl: string }, owner: string): Promise<SkillSource>;
  delete(id: string, owner: string): Promise<void>;
}

export class SkillSourceProtectedError extends Error {
  constructor() {
    super("skill source is managed by the cluster admin and cannot be deleted");
    this.name = "SkillSourceProtectedError";
  }
}

function generateId(): string {
  return `skill-src-${crypto.randomBytes(4).toString("hex")}`;
}

/** Postgres-backed user-source repo. System (admin-seeded) sources never live
 *  here — they're injected as in-memory config; see seed-sources.ts. The
 *  service merges both at read time.
 *
 *  System ids reserve a fixed prefix so a user-created row can never shadow
 *  one. Deletes on a system id throw `SkillSourceProtectedError` regardless
 *  of whether the row exists, mirroring the previous ConfigMap-backed
 *  behavior. */
export function createSkillsRepository(
  db: Db,
  seeds: SkillSourceSeed[] = [],
): SkillsRepository {
  const seedIds = new Set(seeds.map((s) => s.id));

  return {
    async list(owner) {
      const rows = await db
        .select()
        .from(skillSources)
        .where(eq(skillSources.owner, owner));
      return rows.map((r) => ({ id: r.id, name: r.name, gitUrl: r.gitUrl }));
    },

    async get(id, owner) {
      const rows = await db
        .select()
        .from(skillSources)
        .where(and(eq(skillSources.id, id), eq(skillSources.owner, owner)))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return { id: r.id, name: r.name, gitUrl: r.gitUrl };
    },

    async create(input, owner) {
      const id = generateId();
      await db.insert(skillSources).values({
        id,
        owner,
        name: input.name,
        gitUrl: input.gitUrl,
      });
      return { id, name: input.name, gitUrl: input.gitUrl };
    },

    async delete(id, owner) {
      if (seedIds.has(id)) throw new SkillSourceProtectedError();
      await db
        .delete(skillSources)
        .where(and(eq(skillSources.id, id), eq(skillSources.owner, owner)));
    },
  };
}
