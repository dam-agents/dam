export type Harness = "claude-code" | "codex" | "bob" | "pi-agent" | "custom";

export interface HarnessMeta {
  id: Harness;
  label: string;
  tagline: string;
}

/** Pre-built harness images, in display order. `custom` is handled separately
 *  (bring-your-own image) and is not part of this list. */
export const HARNESSES: readonly HarnessMeta[] = [
  {
    id: "bob",
    label: "Bob",
    tagline: "IBM's enterprise AI shell assistant",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    tagline: "Anthropic's agentic coding CLI with full tool use",
  },
  {
    id: "codex",
    label: "Codex",
    tagline: "OpenAI's execution-first coding CLI",
  },
  {
    id: "pi-agent",
    label: "Pi Agent",
    tagline: "Pi coding agent with multi-LLM support",
  },
];

export const CUSTOM_HARNESS: HarnessMeta = {
  id: "custom",
  label: "Custom Image",
  tagline: "Bring your own ACP-compatible image",
};

/** Friendly name for an agent's template id; falls back to the raw id. */
export function harnessLabel(
  templateId: string | null | undefined,
): string | null {
  if (templateId === "custom") return CUSTOM_HARNESS.label;
  return (
    HARNESSES.find((h) => h.id === templateId)?.label ?? templateId ?? null
  );
}
