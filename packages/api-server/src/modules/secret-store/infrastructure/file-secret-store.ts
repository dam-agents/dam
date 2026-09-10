import crypto from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretRef } from "api-server-api";
import type { SecretMetadata, SecretStore } from "../services/secret-store.js";

const NAME_PREFIX = "platform-secret-";

interface StoredSecret {
  metadata: SecretMetadata;
  fields: Record<string, string>;
}

export interface FileSecretStoreOpts {
  /** Root directory, e.g. `/var/lib/dam/secrets`. Must be root-owned 0700. */
  root: string;
  storeId?: string;
}

/**
 * Credential bytes on the node's filesystem, one file per secret under a
 * per-owner directory. The directory is the isolation the `owner` label used to
 * provide: nothing but this process reads the root, and only the rendered
 * per-agent copy is ever exposed — to that agent's gateway, never to the
 * sandbox. Files are written 0600 through a temp-and-rename so a torn write
 * cannot leave a half-secret behind.
 */
export function createFileSecretStore(opts: FileSecretStoreOpts): SecretStore {
  const storeId = opts.storeId ?? "file";

  const ownerDir = (owner: string) => join(opts.root, pathSafe(owner));

  /**
   * A ref path is `<owner>/<name>`, both path-safe segments — the owner is
   * baked in at mint time so every read is a direct open rather than a scan.
   * Refs come back from Postgres, so the shape is re-checked on the way in.
   */
  function secretPath(refPath: string): string {
    if (!/^[A-Za-z0-9._%-]+\/[A-Za-z0-9._%-]+$/.test(refPath)) {
      throw new Error(`malformed secret ref path: ${JSON.stringify(refPath)}`);
    }
    return join(opts.root, `${refPath}.json`);
  }

  function ensureOwn(ref: Pick<SecretRef, "storeId">): void {
    if (ref.storeId !== undefined && ref.storeId !== storeId) {
      throw new Error(
        `file secret store cannot handle ref with storeId=${JSON.stringify(ref.storeId)}`,
      );
    }
  }

  async function readStored(refPath: string): Promise<StoredSecret | null> {
    try {
      return JSON.parse(
        await readFile(secretPath(refPath), "utf8"),
      ) as StoredSecret;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async function writeStored(
    refPath: string,
    stored: StoredSecret,
  ): Promise<void> {
    const target = secretPath(refPath);
    await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
    const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(stored), { mode: 0o600 });
    await rename(tmp, target);
  }

  async function mustRead(refPath: string, op: string): Promise<StoredSecret> {
    const stored = await readStored(refPath);
    if (!stored) {
      throw new Error(
        `${op}: secret ${refPath} does not exist — call put() first`,
      );
    }
    return stored;
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
      await writeStored(ref.path, { metadata: meta, fields });
    },

    async putFields(ref, fields): Promise<void> {
      ensureOwn(ref);
      const stored = await mustRead(ref.path, "putFields");
      await writeStored(ref.path, {
        metadata: stored.metadata,
        fields: { ...stored.fields, ...fields },
      });
    },

    async putField(ref, value): Promise<void> {
      ensureOwn(ref);
      const stored = await mustRead(ref.path, "putField");
      await writeStored(ref.path, {
        metadata: stored.metadata,
        fields: { ...stored.fields, [ref.field]: value },
      });
    },

    async get(ref): Promise<Record<string, string> | null> {
      ensureOwn(ref);
      return (await readStored(ref.path))?.fields ?? null;
    },

    async getField(ref): Promise<string | null> {
      ensureOwn(ref);
      return (await readStored(ref.path))?.fields[ref.field] ?? null;
    },

    async delete(ref): Promise<void> {
      ensureOwn(ref);
      await rm(secretPath(ref.path), { force: true });
    },

    async list(scope): Promise<{ ref: SecretRef; metadata: SecretMetadata }[]> {
      let names: string[];
      try {
        names = await readdir(ownerDir(scope.owner));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const out: { ref: SecretRef; metadata: SecretMetadata }[] = [];
      for (const file of names) {
        if (!file.endsWith(".json")) continue;
        const path = `${pathSafe(scope.owner)}/${file.slice(0, -".json".length)}`;
        const stored = await readStored(path);
        if (!stored) continue;
        if (scope.purpose && stored.metadata.purpose !== scope.purpose) continue;
        out.push({ ref: { storeId, path, field: "" }, metadata: stored.metadata });
      }
      return out;
    },
  };
}

/** Percent-encodes anything that is not safe in a single path segment. */
function pathSafe(value: string): string {
  return value.replace(
    /[^A-Za-z0-9._-]/g,
    (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}
