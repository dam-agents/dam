import { configSchema, type Config } from "../domain/config.js";
import { err, ok, type Result } from "../../../result.js";
import type { FileWriteError, MalformedConfigError } from "../domain/errors.js";
import { stringify } from "smol-toml";
import {
  describeTomlReadProblem,
  readTomlTable,
  writeTomlContents,
} from "../../shared/toml-file.js";
import { zodIssuesMessage } from "../../shared/error-message.js";

export interface ConfigStore {
  read(): Promise<Result<Partial<Config>, MalformedConfigError>>;
  write(partial: Partial<Config>): Promise<Result<void, FileWriteError>>;
}

const partialConfigSchema = configSchema.partial();

export function createTomlConfigStore(filePath: string): ConfigStore {
  return {
    async read() {
      const raw = await readTomlTable(filePath);
      if (!raw.ok) {
        return err({
          kind: "malformed-config",
          reason: describeTomlReadProblem(filePath, raw.error),
        });
      }
      const parsed = partialConfigSchema.safeParse(raw.value);
      if (!parsed.success) {
        return err({
          kind: "malformed-config",
          reason: `invalid config in ${filePath}: ${zodIssuesMessage(parsed.error)}`,
        });
      }
      return ok(parsed.data);
    },

    async write(partial) {
      const raw = await readTomlTable(filePath);
      if (!raw.ok) {
        return err({
          kind: "file-write",
          path: filePath,
          reason: `cannot read existing config: ${raw.error.message}`,
        });
      }

      const serialized = stringify({ ...raw.value, ...partial });
      const written = await writeTomlContents(filePath, serialized);
      if (!written.ok) {
        return err({
          kind: "file-write",
          path: filePath,
          reason: written.error,
        });
      }
      return ok(undefined);
    },
  };
}
