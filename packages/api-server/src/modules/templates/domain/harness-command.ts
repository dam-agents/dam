import type { HarnessFamily } from "api-server-api";

export function spellHarnessCommand(
  name: string,
  harness: HarnessFamily | undefined,
): string {
  return harness === "codex" ? `/prompts:${name}` : `/${name}`;
}
