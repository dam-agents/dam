import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse, stringify, type TomlTable } from "smol-toml";
import { configSchema, type Config } from "../domain/config.js";
import { err, ok, type Result } from "../../../result.js";
import type {
  FileWriteError,
  MalformedConfigError,
} from "../domain/errors.js";

export interface ConfigStore {
  read(): Promise<Result<Partial<Config>, MalformedConfigError>>;
  write(partial: Partial<Config>): Promise<Result<void, FileWriteError>>;
}

const partialConfigSchema = configSchema.partial();

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && "code" in e && typeof e.code === "string"
    ? e.code
    : undefined;
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
      let raw: unknown;
      try {
        raw = parse(contents);
      } catch (e) {
        return err({
          kind: "malformed-config",
          reason: `invalid TOML in ${filePath}: ${errorMessage(e)}`,
        });
      }
      const parsed = partialConfigSchema.safeParse(raw);
      if (!parsed.success) {
        return err({
          kind: "malformed-config",
          reason: `invalid config in ${filePath}: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}`,
        });
      }
      return ok(parsed.data);
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
