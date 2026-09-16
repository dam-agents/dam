import type { HarnessFamily, StarterKit } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The shell a kit's `install` runs once in the new
 * agent's workspace. The kit writes the command; the platform's whole
 * contribution is to tell the bootstrap which harness family the agent runs,
 * through the variable the kit names — exported ahead of the command so it
 * reaches every part of a pipeline — and to say nothing when no family is
 * known, so a harness-aware bootstrap detects it itself.
 */
export function kitInstallCommand(
  kit: Pick<StarterKit, "install">,
  harness: HarnessFamily | undefined,
): string | null {
  if (!kit.install) return null;
  const { command, harnessEnv } = kit.install;
  return harnessEnv && harness
    ? `export ${harnessEnv}=${harness}; ${command}`
    : command;
}
