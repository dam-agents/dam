import type { Config, ConfigKey } from "../domain/config.js";
import { resolveConfig, validateValue } from "../domain/config.js";
import type {
  FileWriteError,
  InvalidValueError,
  MalformedConfigError,
  MissingConfigError,
} from "../domain/errors.js";
import type { Result } from "../../../result.js";
import type { ConfigStore } from "../infrastructure/config-store.js";
import type { EnvReader } from "../infrastructure/env-reader.js";

export interface ConfigService {
  getResolved(opts: {
    flag?: Partial<Config>;
  }): Promise<Result<Config, MissingConfigError | MalformedConfigError>>;
  set(
    key: ConfigKey,
    rawValue: string,
  ): Promise<
    Result<void, InvalidValueError | MalformedConfigError | FileWriteError>
  >;
}

export interface ConfigServiceDeps {
  store: ConfigStore;
  envReader: EnvReader;
  /** Per-key env-var registry. Adding a `Config` field means adding its
   *  env-var name here — `Record<ConfigKey, string>` enforces that. */
  envVars: Record<ConfigKey, string>;
}

export function createConfigService(deps: ConfigServiceDeps): ConfigService {
  const { store, envReader, envVars } = deps;

  function readEnv(): Partial<Config> {
    const out: Partial<Config> = {};
    const server = envReader.get(envVars.server);
    if (server !== undefined) out.server = server;
    return out;
  }

  return {
    async getResolved({ flag }) {
      const fileResult = await store.read();
      if (!fileResult.ok) return fileResult;
      return resolveConfig({ flag, env: readEnv(), file: fileResult.value });
    },

    async set(key, rawValue) {
      const validated = validateValue(key, rawValue);
      if (!validated.ok) return validated;
      return store.write(validated.value);
    },
  };
}
