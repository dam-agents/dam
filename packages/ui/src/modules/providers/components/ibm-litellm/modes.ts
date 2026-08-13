export const MODE_KEYS = ["api-key"] as const;
export type Mode = (typeof MODE_KEYS)[number];

export const MODES = {
  "api-key": {
    label: "API Token",
    placeholder: "sk-…",
  },
} as const satisfies Record<Mode, { label: string; placeholder: string }>;

export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
