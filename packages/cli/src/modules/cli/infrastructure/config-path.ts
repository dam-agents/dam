import { homedir } from "node:os";
import { join } from "node:path";

export function defaultConfigPath(): string {
  return join(homedir(), ".dam", "config.toml");
}
