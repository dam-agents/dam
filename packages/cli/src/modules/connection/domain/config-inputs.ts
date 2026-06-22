import type {
  ConnectionTemplateInput,
  ConnectionTemplateView,
} from "api-server-api";
import { err, ok, type Result } from "../../../result.js";

// The template's optional config inputs.
export function configInputsOf(
  template: ConnectionTemplateView,
): ConnectionTemplateInput[] {
  return template.inputs.filter((i) => i.configInput);
}

// Validate against the input's declared pattern/enumValues; empty = valid (optional, skipped).
export function validateConfigInputValue(
  input: ConnectionTemplateInput,
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const label = input.label ?? input.name;
  if (input.enumValues && !input.enumValues.includes(trimmed)) {
    const opts = input.enumValues.map((v) => `\`${v}\``).join(", ");
    return `${label}: must be one of ${opts}`;
  }
  if (input.pattern && !new RegExp(`^(?:${input.pattern})$`).test(trimmed)) {
    const expected = input.patternHint ?? `value matching ${input.pattern}`;
    return `${label}: expected ${expected}`;
  }
  return undefined;
}

export type ConfigFlagError =
  | { kind: "missing-equals"; input: string }
  | { kind: "unknown-key"; key: string; validKeys: readonly string[] }
  | { kind: "invalid-value"; key: string; message: string };

// Parse repeatable `--config key=value` into a validated configInputs record; blank skips, last wins.
export function resolveConfigInputFlags(
  template: ConnectionTemplateView,
  rawFlags: readonly string[],
): Result<Record<string, string>, ConfigFlagError> {
  const byName = new Map(configInputsOf(template).map((i) => [i.name, i]));
  const out: Record<string, string> = {};
  for (const raw of rawFlags) {
    const eq = raw.indexOf("=");
    if (eq < 0) return err({ kind: "missing-equals", input: raw });
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1).trim();
    const input = byName.get(key);
    if (!input) {
      return err({ kind: "unknown-key", key, validKeys: [...byName.keys()] });
    }
    if (value === "") {
      delete out[key];
      continue;
    }
    const message = validateConfigInputValue(input, value);
    if (message) return err({ kind: "invalid-value", key, message });
    out[key] = value;
  }
  return ok(out);
}
