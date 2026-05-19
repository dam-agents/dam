import type { Config, ConfigKey } from "../domain/config.js";
import {
  resolveConfig,
  SERVER_ENV_VAR,
  validateValue,
} from "../domain/config.js";
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

export function createConfigService(deps: {
  store: ConfigStore;
  envReader: EnvReader;
}): ConfigService {
  const { store, envReader } = deps;

  function readEnv(): Partial<Config> {
    const out: Partial<Config> = {};
    const server = envReader.get(SERVER_ENV_VAR);
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
