import { err, ok, type Result } from "./result.js";
import type { InvalidKeyError, MissingConfigError } from "./errors.js";

export interface Config {
  server: string;
}

export type ConfigKey = keyof Config;

// Adding a new key to `Config` is a compile error here until it's also
// registered, so the runtime keyset cannot drift from the type. The
// `satisfies` clause ensures every `keyof Config` appears as a property.
const KEY_REGISTRY = {
  server: true,
} satisfies Record<ConfigKey, true>;

export const CONFIG_KEYS: readonly ConfigKey[] = Object.keys(
  KEY_REGISTRY,
) as ConfigKey[];

export function isConfigKey(input: string): input is ConfigKey {
  return Object.prototype.hasOwnProperty.call(KEY_REGISTRY, input);
}

export function parseConfigKey(
  input: string,
): Result<ConfigKey, InvalidKeyError> {
  if (isConfigKey(input)) return ok(input);
  return err({ kind: "invalid-key", input, validKeys: CONFIG_KEYS });
}

export interface ConfigSources {
  flag?: Partial<Config>;
  env: Partial<Config>;
  file: Partial<Config>;
}

export function resolveConfig(
  sources: ConfigSources,
): Result<Config, MissingConfigError> {
  const server =
    sources.flag?.server ?? sources.env.server ?? sources.file.server;
  if (server === undefined) {
    return err({ kind: "missing-config", key: "server" });
  }
  return ok({ server });
}
