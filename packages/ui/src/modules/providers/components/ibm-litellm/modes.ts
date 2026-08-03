/** IBM LiteLLM is single-mode (Bearer API token). Q6=A locks the registry
 *  shape to a uniform `modes[]` array regardless — so we keep a length-1
 *  shape here for symmetry with `anthropic/modes.ts`, even though the form
 *  doesn't render a toggle. */
export const MODE_KEYS = ["api-key"] as const;
export type Mode = (typeof MODE_KEYS)[number];

export const MODES = {
  "api-key": {
    label: "API Token",
    placeholder: "sk-…",
  },
} as const satisfies Record<Mode, { label: string; placeholder: string }>;

// Reuse Anthropic's whitespace-stripping policy: pasted-from-terminal tokens
// often pick up newlines, and an exact-match envoy injection makes that fatal.
export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
