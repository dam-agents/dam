/** OpenAI is single-mode (Bearer API token). Q6=A locks the registry shape
 *  to a uniform `modes[]` array regardless — kept as length-1 here for
 *  symmetry with `anthropic/modes.ts` and `ibm-litellm/modes.ts`. */
export const MODE_KEYS = ["api-key"] as const;
export type Mode = (typeof MODE_KEYS)[number];

export const MODES = {
  "api-key": {
    label: "API Key",
    placeholder: "sk-…",
  },
} as const satisfies Record<Mode, { label: string; placeholder: string }>;

// Reuse the whitespace-stripping policy from the other presets:
// terminal-pasted tokens often pick up newlines, and an exact-match envoy
// injection makes that fatal on the wire.
export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
