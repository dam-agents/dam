import { z } from "zod";
import { err, ok, type Result } from "./result.js";
import type {
  InvalidKeyError,
  InvalidValueError,
  MissingConfigError,
} from "./errors.js";

export const configSchema = z.object({
  server: z.url({
    protocol: /^https?$/,
    error: "must be an http(s) URL (e.g. https://platform.example)",
  }),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigKey = keyof Config;

export const CONFIG_KEYS: readonly ConfigKey[] = Object.keys(
  configSchema.shape,
) as ConfigKey[];

export function isConfigKey(input: string): input is ConfigKey {
  return Object.prototype.hasOwnProperty.call(configSchema.shape, input);
}

export function parseConfigKey(
  input: string,
): Result<ConfigKey, InvalidKeyError> {
  if (isConfigKey(input)) return ok(input);
  return err({ kind: "invalid-key", input, validKeys: CONFIG_KEYS });
}

/**
 * Validates a single config value against the schema for its key. Used by
 * `dam config set` to fail fast on bad input before touching the file.
 */
export function validateValue(
  key: ConfigKey,
  rawValue: string,
): Result<Partial<Config>, InvalidValueError> {
  const fieldSchema = configSchema.shape[key];
  const parsed = fieldSchema.safeParse(rawValue);
  if (!parsed.success) {
    return err({
      kind: "invalid-value",
      key,
      input: rawValue,
      reason: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  return ok({ [key]: parsed.data } as Partial<Config>);
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
