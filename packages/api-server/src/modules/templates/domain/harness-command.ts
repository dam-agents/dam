import type { TemplateHarness } from "api-server-api";

export function spellHarnessCommand(
  name: string,
  harness: TemplateHarness | undefined,
): string {
  return harness === "codex" ? `/prompts:${name}` : `/${name}`;
}
