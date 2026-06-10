import type { Command } from "commander";
import { buildToggleCommand, type ToggleDeps } from "./toggle-command.js";

export function buildDisableCommand(deps: ToggleDeps): Command {
  return buildToggleCommand(deps, false);
}
