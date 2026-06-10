import type { Command } from "commander";
import { buildToggleCommand, type ToggleDeps } from "./toggle-command.js";

export function buildEnableCommand(deps: ToggleDeps): Command {
  return buildToggleCommand(deps, true);
}
