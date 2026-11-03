import { randomUUID } from "node:crypto";
import { asc, avatarImages, type Db, inArray, loginTestimonials } from "db";

export interface StoredTestimonial {
  name: string;
  role: string;
  quote: string;
  photoId: string | null;
  updatedAt: string;
}

export interface TestimonialsRepository {
  list(): Promise<StoredTestimonial[]>;
  replace(
    rows: readonly Omit<StoredTestimonial, "updatedAt">[],
    updatedBy: string,
  ): Promise<void>;
  storedPhotos(ids: readonly string[]): Promise<Set<string>>;
}

// UNIT_BOUNDARY_DESCRIPTION: the login testimonials in Postgres, read in their position order. A replace deletes the list and writes the new one in one transaction, so a reader sees the old list or the new one, never a mix.
export function createTestimonialsRepository(db: Db): TestimonialsRepository {
  return {
    async list() {
      const rows = await db
        .select()
        .from(loginTestimonials)
        .orderBy(asc(loginTestimonials.position));
      return rows.map((row) => ({
        name: row.name,
        role: row.role,
        quote: row.quote,
        photoId: row.photoId,
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
    async replace(rows, updatedBy) {
      await db.transaction(async (tx) => {
        await tx.delete(loginTestimonials);
        if (rows.length === 0) return;
        await tx.insert(loginTestimonials).values(
          rows.map((row, position) => ({
            id: randomUUID(),
            position,
            name: row.name,
            role: row.role,
            quote: row.quote,
            photoId: row.photoId,
            updatedBy,
          })),
        );
      });
    },
    async storedPhotos(ids) {
      if (ids.length === 0) return new Set();
      const rows = await db
        .select({ id: avatarImages.id })
        .from(avatarImages)
        .where(inArray(avatarImages.id, [...ids]));
      return new Set(rows.map((row) => row.id));
    },
  };
}
