import crypto from "node:crypto";
import { and, eq, secrets, sql, type Db } from "db";
import type { SecretRef } from "api-server-api";
import type { SecretMetadata, SecretStore } from "../services/secret-store.js";

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
 * run, so a ref cannot name a row minted for a different owner.
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
          metadata: meta as unknown as Record<string, unknown>,
          fields,
        })
        .onConflictDoUpdate({
          target: [secrets.storeId, secrets.path],
          set: {
            owner: meta.owner,
            purpose: meta.purpose,
            metadata: meta as unknown as Record<string, unknown>,
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

    async list(scope): Promise<{ ref: SecretRef; metadata: SecretMetadata }[]> {
      const where = scope.purpose
        ? and(
            eq(secrets.storeId, storeId),
            eq(secrets.owner, scope.owner),
            eq(secrets.purpose, scope.purpose),
          )
        : and(eq(secrets.storeId, storeId), eq(secrets.owner, scope.owner));
      const rows = await db.select().from(secrets).where(where);
      return rows.map((row) => ({
        ref: { storeId, path: row.path, field: "" },
        metadata: row.metadata as unknown as SecretMetadata,
      }));
    },
  };
}

function pathSafe(value: string): string {
  return value.replace(
    /[^A-Za-z0-9._-]/g,
    (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}
