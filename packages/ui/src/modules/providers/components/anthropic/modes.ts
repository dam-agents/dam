import { type EnvMapping, PROVIDERS } from "../../../../types.js";

// Toggle order, Zod enum source, and iteration order.
export const MODE_KEYS = ["oauth", "api-key"] as const;
export type Mode = (typeof MODE_KEYS)[number];

function modeFor(modeKey: Mode) {
  const mode = PROVIDERS.anthropic.modes.find((m) => m.key === modeKey);
  if (!mode) throw new Error(`PROVIDERS.anthropic missing mode "${modeKey}"`);
  return mode;
}

function prefixFor(modeKey: Mode): string {
  const prefix = modeFor(modeKey).tokenPrefix;
  if (prefix === undefined) {
    throw new Error(`PROVIDERS.anthropic mode "${modeKey}" has no tokenPrefix`);
  }
  return prefix;
}

// `placeholder` is UI-only; everything else derives from the shared registry.
export const MODES = {
  oauth: {
    label: modeFor("oauth").label,
    placeholder: "sk-ant-oat-…",
    prefix: prefixFor("oauth"),
    templateId: modeFor("oauth").templateId,
    mapping: modeFor("oauth").defaultEnvMappings[0],
  },
  "api-key": {
    label: modeFor("api-key").label,
    placeholder: "sk-ant-api-…",
    prefix: prefixFor("api-key"),
    templateId: modeFor("api-key").templateId,
    mapping: modeFor("api-key").defaultEnvMappings[0],
  },
} as const satisfies Record<
  Mode,
  {
    label: string;
    placeholder: string;
    prefix: string;
    templateId: string;
    mapping: EnvMapping;
  }
>;

export function detectMode(envName?: string): Mode {
  return envName === MODES["api-key"].mapping.envName ? "api-key" : "oauth";
}

// `claude setup-token` output can pick up newlines on copy, so strip all whitespace.
export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
