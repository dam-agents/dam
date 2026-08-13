import { homedir } from "node:os";
import { join } from "node:path";

export function defaultAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_STATE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "dam", "auth.toml");
  return join(homedir(), ".local", "state", "dam", "auth.toml");
}
