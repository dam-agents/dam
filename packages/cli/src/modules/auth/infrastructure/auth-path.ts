import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves the production auth-state file location per the XDG Base
 * Directory Specification: `$XDG_STATE_HOME/dam/auth.toml`, falling back
 * to `~/.local/state/dam/auth.toml` when the override is unset or empty.
 *
 * State (not config) — credentials are machine-managed, not user-edited,
 * so they live under the XDG state seam alongside other tools' tokens.
 *
 * Takes env as a parameter so the function is unit-testable without
 * monkey-patching `process.env`. Defaults to `process.env` so production
 * callers don't need to know about the seam.
 */
export function defaultAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "dam", "auth.toml");
  return join(homedir(), ".local", "state", "dam", "auth.toml");
}
