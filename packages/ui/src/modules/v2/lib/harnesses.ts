export type Harness = "claude-code" | "codex" | "bob";

export interface HarnessMeta {
  id: Harness;
  label: string;
  tagline: string;
}

export const HARNESSES: readonly HarnessMeta[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    tagline: "Anthropic's coding agent, ready in the terminal.",
  },
  {
    id: "codex",
    label: "Codex",
    tagline: "OpenAI's Codex CLI, powered by your API key.",
  },
  {
    id: "bob",
    label: "Bob",
    tagline: "IBM's Bob Shell, set up and waiting.",
  },
];

/** Friendly name for an agent's template id; falls back to the raw id. */
export function harnessLabel(
  templateId: string | null | undefined,
): string | null {
  return (
    HARNESSES.find((h) => h.id === templateId)?.label ?? templateId ?? null
  );
}
