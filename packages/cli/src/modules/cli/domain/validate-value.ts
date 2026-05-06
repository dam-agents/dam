import { err, ok, type Result } from "./result.js";
import type { Config, ConfigKey } from "./config.js";
import type { InvalidValueError } from "./errors.js";

export function validateValue(
  key: ConfigKey,
  rawValue: string,
): Result<Partial<Config>, InvalidValueError> {
  switch (key) {
    case "server": {
      let parsed: URL;
      try {
        parsed = new URL(rawValue);
      } catch {
        return err({
          kind: "invalid-value",
          key,
          input: rawValue,
          reason: "must be an http(s) URL (e.g. https://platform.example)",
        });
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return err({
          kind: "invalid-value",
          key,
          input: rawValue,
          reason: "must be an http(s) URL (e.g. https://platform.example)",
        });
      }
      return ok({ server: rawValue });
    }
  }
}
