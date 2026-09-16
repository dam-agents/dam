import type { HarnessFamily } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: How each harness family expands an installed
 * command that arrives as a prompt: Codex namespaces prompts under
 * `/prompts:`, the others take the bare slash command. A kit or a bootstrap
 * names the command; only the platform knows which harness it lands on.
 */
export function spellHarnessCommand(
  name: string,
  harness: HarnessFamily | undefined,
): string {
  return harness === "codex" ? `/prompts:${name}` : `/${name}`;
}
