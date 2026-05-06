import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse, stringify, type TomlTable } from "smol-toml";
import type { Config } from "../domain/config.js";
import { err, ok, type Result } from "../domain/result.js";
import type {
  FileWriteError,
  MalformedConfigError,
} from "../domain/errors.js";

export interface ConfigStore {
  read(): Promise<Result<Partial<Config>, MalformedConfigError>>;
  write(partial: Partial<Config>): Promise<Result<void, FileWriteError>>;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && "code" in e && typeof e.code === "string"
    ? e.code
    : undefined;
}

function pickKnownKeys(raw: TomlTable): Partial<Config> {
  // Add another `if (typeof raw.<key> === "string")` arm when extending
  // `Config` with a new string field — TypeScript will flag the missing
  // `out.<key>` assignment, but won't force you to read it from the file,
  // so this list is a deliberate review point.
  const out: Partial<Config> = {};
  if (typeof raw.server === "string") {
    out.server = raw.server;
  }
  return out;
}

export function createTomlConfigStore(filePath: string): ConfigStore {
  return {
    async read() {
      let contents: string;
      try {
        contents = await readFile(filePath, "utf-8");
      } catch (e) {
        // ENOENT = no file yet; treat as empty config (per ADR-039 spec).
        if (errnoCode(e) === "ENOENT") return ok({});
        return err({
          kind: "malformed-config",
          reason: `cannot read ${filePath}: ${errorMessage(e)}`,
        });
      }
      try {
        return ok(pickKnownKeys(parse(contents)));
      } catch (e) {
        return err({
          kind: "malformed-config",
          reason: `invalid TOML in ${filePath}: ${errorMessage(e)}`,
        });
      }
    },

    async write(partial) {
      // Read-merge-write to preserve unrelated top-level keys; the file is
      // shared with future config knobs and possibly user-added comments
      // we don't want to clobber.
      let existing: TomlTable = {};
      try {
        existing = parse(await readFile(filePath, "utf-8"));
      } catch (e) {
        if (errnoCode(e) !== "ENOENT") {
          return err({
            kind: "file-write",
            path: filePath,
            reason: `cannot read existing config: ${errorMessage(e)}`,
          });
        }
      }

      const merged = { ...existing, ...partial };
      const serialized = stringify(merged);

      try {
        await mkdir(dirname(filePath), { recursive: true });
        const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, serialized, "utf-8");
        await rename(tmp, filePath);
        return ok(undefined);
      } catch (e) {
        return err({
          kind: "file-write",
          path: filePath,
          reason: errorMessage(e),
        });
      }
    },
  };
}
