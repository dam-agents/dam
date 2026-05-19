import { type EnvMapping, PROVIDERS } from "../../../../types.js";

/** Ordered Mode keys — left→right toggle order, Zod enum source, and
 *  iteration order. */
export const MODE_KEYS = ["oauth", "api-key"] as const;
export type Mode = (typeof MODE_KEYS)[number];

function mappingFor(modeKey: Mode): EnvMapping {
  const mode = PROVIDERS.anthropic.modes.find((m) => m.key === modeKey);
  if (!mode) throw new Error(`PROVIDERS.anthropic missing mode "${modeKey}"`);
  return mode.defaultEnvMappings[0];
}

/** UI presentation per mode. Placeholder + prefix are UI-only (the
 *  registry doesn't track them); `mapping` is the env-var entry the
 *  form sends to `createSecret`. */
export const MODES = {
  oauth: {
    label: "OAuth Token",
    placeholder: "sk-ant-oat-…",
    prefix: "sk-ant-oat-",
    mapping: mappingFor("oauth"),
  },
  "api-key": {
    label: "API Key",
    placeholder: "sk-ant-api-…",
    prefix: "sk-ant-api-",
    mapping: mappingFor("api-key"),
  },
} as const satisfies Record<
  Mode,
  {
    label: string;
    placeholder: string;
    prefix: string;
    mapping: EnvMapping;
  }
>;

export function detectMode(envName?: string): Mode {
  return envName === MODES["api-key"].mapping.envName ? "api-key" : "oauth";
}

// `claude setup-token` output often gets a newline inserted mid-string when
// copied from a terminal, so strip all whitespace rather than just trimming
// the ends.
export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
