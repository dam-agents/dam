import { stringify, type TomlTable } from "smol-toml";
import { z } from "zod";
import type { HostAuth } from "../domain/host-auth.js";
import { err, ok, type Result } from "../../../result.js";
import type {
  AuthStoreReadError,
  AuthStoreWriteError,
  MalformedAuthStoreError,
} from "../domain/errors.js";
import {
  describeTomlReadProblem,
  readTomlTable,
  writeTomlContents,
} from "../../shared/toml-file.js";
import { zodIssuesMessage } from "../../shared/error-message.js";
import { normalizeServerUrl } from "../../shared/server-url.js";

export type HostUrl = string;

export interface AuthStore {
  read(): Promise<
    Result<
      ReadonlyMap<HostUrl, HostAuth>,
      AuthStoreReadError | MalformedAuthStoreError
    >
  >;
  write(
    host: HostUrl,
    value: HostAuth,
  ): Promise<Result<void, AuthStoreWriteError>>;
  remove(host: HostUrl): Promise<Result<void, AuthStoreWriteError>>;
}

const hostEntrySchema = z.object({
  issuer: z.string().min(1),
  username: z.string().min(1),
  sub: z.string().min(1),
  cli_client_id: z.string().min(1),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.union([z.string().min(1), z.date()]),
});

const fileSchema = z
  .object({
    hosts: z.record(z.string(), hostEntrySchema).optional(),
  })
  .passthrough();

const FILE_MODE = 0o600;

function toHostAuth(
  raw: z.infer<typeof hostEntrySchema>,
): Result<HostAuth, MalformedAuthStoreError> {
  const expiresAt =
    raw.expires_at instanceof Date ? raw.expires_at : new Date(raw.expires_at);
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
    expires_at: value.expiresAt.toISOString(),
  };
}

function hostsOf(table: TomlTable): TomlTable {
  return (
    table.hosts && typeof table.hosts === "object" ? table.hosts : {}
  ) as TomlTable;
}

function hostsOtherThan(hosts: TomlTable, host: HostUrl): TomlTable {
  return Object.fromEntries(
    Object.entries(hosts).filter(
      ([saved]) => normalizeServerUrl(saved) !== host,
    ),
  );
}

export function createTomlAuthStore(filePath: string): AuthStore {
  async function readForWrite(): Promise<
    Result<TomlTable, AuthStoreWriteError>
  > {
    const raw = await readTomlTable(filePath);
    if (raw.ok) return raw;
    return err({
      kind: "auth-store-write",
      path: filePath,
      reason: `cannot read existing auth store: ${describeTomlReadProblem(filePath, raw.error)}`,
    });
  }

  async function writeHosts(
    merged: TomlTable,
  ): Promise<Result<void, AuthStoreWriteError>> {
    const written = await writeTomlContents(
      filePath,
      stringify(merged),
      FILE_MODE,
    );
    if (written.ok) return written;
    return err({
      kind: "auth-store-write",
      path: filePath,
      reason: written.error,
    });
  }

  return {
    async read() {
      const raw = await readTomlTable(filePath);
      if (!raw.ok) {
        return err({
          kind:
            raw.error.problem === "invalid"
              ? ("malformed-auth-store" as const)
              : ("auth-store-read" as const),
          reason: describeTomlReadProblem(filePath, raw.error),
        });
      }
      const parsed = fileSchema.safeParse(raw.value);
      if (!parsed.success) {
        return err({
          kind: "malformed-auth-store",
          reason: `invalid auth store in ${filePath}: ${zodIssuesMessage(parsed.error)}`,
        });
      }
      const out = new Map<HostUrl, HostAuth>();
      for (const [saved, entry] of Object.entries(parsed.data.hosts ?? {})) {
        const converted = toHostAuth(entry);
        if (!converted.ok) return converted;
        const host = normalizeServerUrl(saved);
        const other = out.get(host);
        if (
          other === undefined ||
          other.expiresAt < converted.value.expiresAt
        ) {
          out.set(host, converted.value);
        }
      }
      return ok(out);
    },

    async write(rawHost, value) {
      const raw = await readForWrite();
      if (!raw.ok) return raw;
      const host = normalizeServerUrl(rawHost);
      return writeHosts({
        ...raw.value,
        hosts: {
          ...hostsOtherThan(hostsOf(raw.value), host),
          [host]: fromHostAuth(value),
        },
      });
    },

    async remove(rawHost) {
      const raw = await readForWrite();
      if (!raw.ok) return raw;
      const existingHosts = hostsOf(raw.value);
      const remainingHosts = hostsOtherThan(
        existingHosts,
        normalizeServerUrl(rawHost),
      );
      if (
        Object.keys(remainingHosts).length === Object.keys(existingHosts).length
      ) {
        return ok(undefined);
      }
      return writeHosts({ ...raw.value, hosts: remainingHosts });
    },
  };
}
