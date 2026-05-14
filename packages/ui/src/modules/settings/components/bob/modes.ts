/** Bob Shell is single-mode (Bearer API token). Length-1 shape kept for
 *  symmetry with `anthropic/modes.ts` and `ibm-litellm/modes.ts`. */
export const MODE_KEYS = ["api-key"] as const;
export type Mode = (typeof MODE_KEYS)[number];

export const MODES = {
  "api-key": {
    label: "API Key",
    placeholder: "sk-…",
  },
} as const satisfies Record<Mode, { label: string; placeholder: string }>;

// Reuse the whitespace-stripping policy from other presets: pasted-from-terminal
// tokens often pick up newlines, and the exact-match envoy injection makes that fatal.
export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
