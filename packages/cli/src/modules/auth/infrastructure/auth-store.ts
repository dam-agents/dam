import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse, stringify, type TomlTable } from "smol-toml";
import { z } from "zod";
import type { HostAuth } from "../domain/host-auth.js";
import { err, ok, type Result } from "../../../result.js";
import type {
  AuthStoreReadError,
  AuthStoreWriteError,
  MalformedAuthStoreError,
} from "../domain/errors.js";

/**
 * The host URL is the key into the `auth.toml` `hosts` table — e.g.
 * `"http://dam.localhost:4444"`. Kept as a plain string so callers can pass
 * the Active Host straight from `config.toml`'s `server` field without a
 * type-cast dance.
 */
export type HostUrl = string;

export interface AuthStore {
  read(): Promise<
    Result<
      ReadonlyMap<HostUrl, HostAuth>,
      AuthStoreReadError | MalformedAuthStoreError
    >
  >;
  write(host: HostUrl, value: HostAuth): Promise<Result<void, AuthStoreWriteError>>;
  remove(host: HostUrl): Promise<Result<void, AuthStoreWriteError>>;
}

const hostEntrySchema = z.object({
  issuer: z.string().min(1),
  username: z.string().min(1),
  sub: z.string().min(1),
  cli_client_id: z.string().min(1),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  // smol-toml parses unquoted `YYYY-MM-DDTHH:MM:SSZ` as Date and quoted as
  // string. Accept both so a hand-edited file with either shape round-trips.
  expires_at: z.union([z.string().min(1), z.date()]),
});

const fileSchema = z.object({
  hosts: z.record(z.string(), hostEntrySchema).optional(),
}).passthrough();

const FILE_MODE = 0o600;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && "code" in e && typeof e.code === "string"
    ? e.code
    : undefined;
}

function toHostAuth(
  raw: z.infer<typeof hostEntrySchema>,
): Result<HostAuth, MalformedAuthStoreError> {
  const expiresAt = raw.expires_at instanceof Date
    ? raw.expires_at
    : new Date(raw.expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    return err({
      kind: "malformed-auth-store",
      reason: `expires_at is not a valid ISO 8601 instant: ${String(raw.expires_at)}`,
    });
  }
  return ok({
    issuer: raw.issuer,
    username: raw.username,
    sub: raw.sub,
    cliClientId: raw.cli_client_id,
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt,
  });
}

function fromHostAuth(value: HostAuth): TomlTable {
  return {
    issuer: value.issuer,
    username: value.username,
    sub: value.sub,
    cli_client_id: value.cliClientId,
    access_token: value.accessToken,
    refresh_token: value.refreshToken,
    // Always emit a quoted ISO 8601 string for unambiguous round-tripping.
    expires_at: value.expiresAt.toISOString(),
  };
}

async function readRawFile(
  filePath: string,
): Promise<Result<TomlTable, AuthStoreReadError | MalformedAuthStoreError>> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return ok({});
    return err({
      kind: "auth-store-read",
      reason: `cannot read ${filePath}: ${errorMessage(e)}`,
    });
  }
  try {
    return ok(parse(contents));
  } catch (e) {
    return err({
      kind: "malformed-auth-store",
      reason: `invalid TOML in ${filePath}: ${errorMessage(e)}`,
    });
  }
}

async function writeFileAtomic(
  filePath: string,
  contents: string,
): Promise<Result<void, AuthStoreWriteError>> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(dirname(filePath), { recursive: true });
    // Defensive: pass mode AND chmod after — the mode flag is masked by
    // umask on create, so the explicit chmod is what actually guarantees
    // 0600 (gemini-cli idiom).
    await writeFile(tmp, contents, { encoding: "utf-8", mode: FILE_MODE });
    await chmod(tmp, FILE_MODE);
    await rename(tmp, filePath);
    return ok(undefined);
  } catch (e) {
    // Best-effort cleanup so we don't leak a 0600 file containing a
    // refresh token on the user's disk when rename (or any earlier step)
    // fails. Errors here are swallowed — the original error wins.
    await unlink(tmp).catch(() => {});
    return err({
      kind: "auth-store-write",
      path: filePath,
      reason: errorMessage(e),
    });
  }
}

// Note: `write` and `remove` use read-merge-rename. The rename itself is
// atomic, but the read→merge→rename sequence is not coordinated across
// processes — two concurrent `dam` invocations can each persist their own
// merged snapshot and the later rename silently reverts the other host's
// entry. Accepted for v1 (solo-terminal use); see docs/architecture/cli.md
// "Authentication" section for the deferred fix (per-host files or
// cross-process locking).
export function createTomlAuthStore(filePath: string): AuthStore {
  return {
    async read() {
      const raw = await readRawFile(filePath);
      if (!raw.ok) return raw;
      const parsed = fileSchema.safeParse(raw.value);
      if (!parsed.success) {
        return err({
          kind: "malformed-auth-store",
          reason: `invalid auth store in ${filePath}: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}`,
        });
      }
      const out = new Map<HostUrl, HostAuth>();
      for (const [host, entry] of Object.entries(parsed.data.hosts ?? {})) {
        const converted = toHostAuth(entry);
        if (!converted.ok) return converted;
        out.set(host, converted.value);
      }
      return ok(out);
    },

    async write(host, value) {
      const raw = await readRawFile(filePath);
      if (!raw.ok) {
        // A malformed existing file would otherwise be clobbered silently;
        // surface as a write error so the caller can decide what to do.
        return err({
          kind: "auth-store-write",
          path: filePath,
          reason: `cannot read existing auth store: ${raw.error.reason}`,
        });
      }
      const existing = raw.value;
      const existingHosts =
        (existing.hosts && typeof existing.hosts === "object"
          ? existing.hosts as TomlTable
          : {}) as TomlTable;
      const mergedHosts: TomlTable = {
        ...existingHosts,
        [host]: fromHostAuth(value),
      };
      const merged: TomlTable = { ...existing, hosts: mergedHosts };
      return writeFileAtomic(filePath, stringify(merged));
    },

    async remove(host) {
      const raw = await readRawFile(filePath);
      if (!raw.ok) {
        return err({
          kind: "auth-store-write",
          path: filePath,
          reason: `cannot read existing auth store: ${raw.error.reason}`,
        });
      }
      const existing = raw.value;
      const existingHosts =
        (existing.hosts && typeof existing.hosts === "object"
          ? existing.hosts as TomlTable
          : {}) as TomlTable;
      if (!(host in existingHosts)) return ok(undefined);
      const { [host]: _removed, ...remainingHosts } = existingHosts;
      const merged: TomlTable = { ...existing, hosts: remainingHosts };
      return writeFileAtomic(filePath, stringify(merged));
    },
  };
}
