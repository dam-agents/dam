import { randomUUID } from "node:crypto";

import { eq, type Db, runArtifacts } from "db";

import type { Artifact, ArtifactStore } from "../domain/artifact-store.js";

/** Postgres-backed ArtifactStore: blobs live inline in `run_artifacts.content`
 *  (bytea). `key` carries the unique index; `id` is an internal surrogate. put
 *  upserts on `key` so re-storing a Candidate is idempotent. No size policy
 *  here — that is the service's job. */
export function createPostgresArtifactStore(db: Db): ArtifactStore {
  return {
    async put(input) {
      await db
        .insert(runArtifacts)
        .values({
          id: randomUUID(),
          key: input.key,
          contentType: input.contentType,
          sizeBytes: input.content.byteLength,
          content: input.content,
        })
        .onConflictDoUpdate({
          target: runArtifacts.key,
          set: {
            contentType: input.contentType,
            sizeBytes: input.content.byteLength,
            content: input.content,
          },
        });
    },

    async get(key): Promise<Artifact | null> {
      const [row] = await db
        .select()
        .from(runArtifacts)
        .where(eq(runArtifacts.key, key))
        .limit(1);
      if (!row) return null;
      return {
        key: row.key,
        content: row.content,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        createdAt: row.createdAt,
      };
    },

    async exists(key): Promise<boolean> {
      const [row] = await db
        .select({ key: runArtifacts.key })
        .from(runArtifacts)
        .where(eq(runArtifacts.key, key))
        .limit(1);
      return row !== undefined;
    },
  };
}
