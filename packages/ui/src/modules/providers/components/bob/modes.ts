import { PROVIDERS } from "../../../../types.js";

export const MODE_KEYS = ["api-key", "inference"] as const;
export type Mode = (typeof MODE_KEYS)[number];

function modeFor(modeKey: Mode) {
  const mode = PROVIDERS.bob.modes.find((m) => m.key === modeKey);
  if (!mode) throw new Error(`PROVIDERS.bob missing mode "${modeKey}"`);
  return mode;
}

export const MODES = {
  "api-key": {
    label: modeFor("api-key").label,
    placeholder: "bob_prod_bob-apikey_…",
    templateId: modeFor("api-key").templateId,
  },
  inference: {
    label: modeFor("inference").label,
    placeholder: "bob_prod_bob-apikey_…",
    templateId: modeFor("inference").templateId,
  },
} as const satisfies Record<
  Mode,
  { label: string; placeholder: string; templateId: string }
>;

export function modeForTemplateId(templateId: string): Mode {
  return templateId === MODES.inference.templateId ? "inference" : "api-key";
}

export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
