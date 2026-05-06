import { Command } from "commander";
import { readPackageVersion } from "./infrastructure/package-version.js";

export function compose(): Command {
  const program = new Command();
  program
    .name("dam")
    .description("Command-line client for a Platform deployment")
    .version(readPackageVersion());
  return program;
}
