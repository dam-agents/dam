import { homedir } from "node:os";
import { join } from "node:path";

export function defaultConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "dam", "config.toml");
  return join(homedir(), ".config", "dam", "config.toml");
}
