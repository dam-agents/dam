import crypto from "node:crypto";
import { and, eq, secrets, sql, type Db } from "db";
import type { SecretRef } from "api-server-api";
import type { SecretMetadata, SecretStore } from "../services/secret-store.js";
import { pathSafe } from "../domain/ref-path.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Credential bytes in Postgres, one row per secret,
 * keyed by the ref the connection rows already carry. A node holds no
 * authoritative credential of its own: it materializes the ones its agents were
 * granted into that agent's gateway directory and nowhere else, so an agent can
 * be placed on any node without its credentials having to move with it. That is
 * the whole reason this is not the node's filesystem.
 *
 * The owner is baked into the ref at mint time, so every read is a primary-key
 * lookup rather than a scan, and a ref arriving from elsewhere is re-checked
 * for shape before it reaches a query — two segments, neither of them a dot
 * run. That check is against a ref that walks out of the keyspace, and nothing
 * more: a well-formed ref naming somebody else's row is a well-formed ref, and
 * this store has no caller to compare it against. Owner scoping is `list`,
 * whose clause is the `owner` column, and it is the caller's business to reach
 * a ref only through one. Saying the shape check does that work would be the
 * kind of belief that leaves a hole where a check used to be.
 */
const NAME_PREFIX = "platform-secret-";
const REF_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._%-]+$/;

export interface PgSecretStoreOpts {
  db: Db;
  storeId?: string;
}

export function createPgSecretStore(opts: PgSecretStoreOpts): SecretStore {
  const storeId = opts.storeId ?? "pg";
  const db = opts.db;

  function checkPath(path: string): string {
    const segments = path.split("/");
    if (segments.length !== 2 || !segments.every((s) => REF_SEGMENT.test(s))) {
      throw new Error(`malformed secret ref path: ${JSON.stringify(path)}`);
    }
    return path;
  }

  function ensureOwn(ref: Pick<SecretRef, "storeId">): void {
    if (ref.storeId !== undefined && ref.storeId !== storeId) {
      throw new Error(
        `pg secret store cannot handle ref with storeId=${JSON.stringify(ref.storeId)}`,
      );
    }
  }

  const rowOf = (path: string) =>
    db
      .select()
      .from(secrets)
      .where(and(eq(secrets.storeId, storeId), eq(secrets.path, path)))
      .limit(1)
      .then((rows) => rows[0] ?? null);

  async function mergeFields(
    ref: SecretRef,
    op: string,
    patch: Record<string, string>,
  ): Promise<void> {
    ensureOwn(ref);
    const path = checkPath(ref.path);
    const updated = await db
      .update(secrets)
      .set({
        fields: sql`${secrets.fields} || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(secrets.storeId, storeId), eq(secrets.path, path)))
      .returning({ path: secrets.path });
    if (updated.length === 0) {
      throw new Error(
        `${op}: secret ${path} does not exist — call put() first`,
      );
    }
  }

  return {
    storeId,

    mintRef(meta): SecretRef {
      const nonce = crypto.randomBytes(8).toString("hex");
      const digest = crypto
        .createHash("sha256")
        .update(`${meta.owner}|${meta.purpose}|${nonce}`)
        .digest("hex")
        .slice(0, 12);
      const purposeSlug = pathSafe(meta.purpose).slice(0, 24);
      return {
        storeId,
        path: `${pathSafe(meta.owner)}/${NAME_PREFIX}${purposeSlug}-${digest}`,
        field: "",
      };
    },

    async put(ref, fields, meta): Promise<void> {
      ensureOwn(ref);
      const path = checkPath(ref.path);
      await db
        .insert(secrets)
        .values({
          storeId,
          path,
          owner: meta.owner,
          purpose: meta.purpose,
          metadata: extrasOf(meta),
          fields,
        })
        .onConflictDoUpdate({
          target: [secrets.storeId, secrets.path],
          set: {
            owner: meta.owner,
            purpose: meta.purpose,
            metadata: extrasOf(meta),
            fields,
            updatedAt: new Date(),
          },
        });
    },

    async putFields(ref, fields): Promise<void> {
      await mergeFields(ref, "putFields", fields);
    },

    async putField(ref, value): Promise<void> {
      await mergeFields(ref, "putField", { [ref.field]: value });
    },

    async get(ref): Promise<Record<string, string> | null> {
      ensureOwn(ref);
      const path = checkPath(ref.path);
      return (await rowOf(path))?.fields ?? null;
    },

    async getField(ref): Promise<string | null> {
      ensureOwn(ref);
      const path = checkPath(ref.path);
      return (await rowOf(path))?.fields[ref.field] ?? null;
    },

    async delete(ref): Promise<void> {
      ensureOwn(ref);
      const path = checkPath(ref.path);
      await db
        .delete(secrets)
        .where(and(eq(secrets.storeId, storeId), eq(secrets.path, path)));
    },

    async listByPurpose(
      purpose,
    ): Promise<{ ref: SecretRef; metadata: SecretMetadata }[]> {
      const rows = await db
        .select()
        .from(secrets)
        .where(and(eq(secrets.storeId, storeId), eq(secrets.purpose, purpose)));
      return rows.map(metadataRow);
    },

    async list(scope): Promise<{ ref: SecretRef; metadata: SecretMetadata }[]> {
      const where = scope.purpose
        ? and(
            eq(secrets.storeId, storeId),
            eq(secrets.owner, scope.owner),
            eq(secrets.purpose, scope.purpose),
          )
        : and(eq(secrets.storeId, storeId), eq(secrets.owner, scope.owner));
      const rows = await db.select().from(secrets).where(where);
      return rows.map(metadataRow);
    },
  };

  function metadataRow(row: {
    path: string;
    owner: string;
    purpose: string;
    metadata: unknown;
  }): { ref: SecretRef; metadata: SecretMetadata } {
    return {
      ref: { storeId, path: row.path, field: "" },
      metadata: {
        owner: row.owner,
        purpose: row.purpose,
        ...(row.metadata as Pick<
          SecretMetadata,
          "extraLabels" | "extraAnnotations"
        >),
      },
    };
  }
}

const extrasOf = (meta: SecretMetadata): Record<string, unknown> => ({
  ...(meta.extraLabels ? { extraLabels: meta.extraLabels } : {}),
  ...(meta.extraAnnotations ? { extraAnnotations: meta.extraAnnotations } : {}),
});
