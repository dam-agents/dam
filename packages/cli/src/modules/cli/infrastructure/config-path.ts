import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves the production config-file location per the XDG Base Directory
 * Specification: `$XDG_CONFIG_HOME/dam/config.toml`, falling back to
 * `~/.config/dam/config.toml` when the override is unset or empty.
 *
 * Takes env as a parameter so the function is unit-testable without
 * monkey-patching `process.env`. Defaults to `process.env` so production
 * callers (compose.ts) don't need to know about the seam.
 */
export function defaultConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "dam", "config.toml");
  return join(homedir(), ".config", "dam", "config.toml");
}
