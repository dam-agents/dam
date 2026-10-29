import { Command } from "commander";
import { CLI_PACKAGE } from "../infrastructure/npm-latest-probe.js";
import type { UpdateError, UpdateService } from "../services/update-service.js";
import { EXIT_RUNTIME_FAILURE, EXIT_SUCCESS } from "../../shared/exit-codes.js";

export interface UpdateCommandDeps {
  service: UpdateService;
}

export function buildUpdateCommand(deps: UpdateCommandDeps): Command {
  return new Command("update")
    .alias("upgrade")
    .description("Update the CLI to the latest stable release")
    .addHelpText("after", "\nAlias: `dam upgrade`\n")
    .action(async () => {
      const result = await deps.service.update();
      if (!result.ok) {
        printError(result.error);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      if (result.value.kind === "current") {
        process.stdout.write(
          `CLI ${result.value.version} is already up to date.\n`,
        );
        process.exit(EXIT_SUCCESS);
      }
      process.stdout.write(
        `Updated CLI from ${result.value.from} to ${result.value.to}.\n`,
      );
      process.exit(EXIT_SUCCESS);
    });
}

function printError(error: UpdateError): void {
  const manual = `npm install -g ${CLI_PACKAGE}@latest`;
  switch (error.kind) {
    case "latest-unavailable":
      process.stderr.write(
        `error: could not check the latest CLI version: ${error.cause.message}\n`,
      );
      return;
    case "npm-not-found":
      process.stderr.write(
        `error: npm was not found on PATH; update manually with \`${manual}\`\n`,
      );
      return;
    case "npm-launch-failed":
      process.stderr.write(
        `error: could not start npm: ${error.message}\nhint: update manually with \`${manual}\`\n`,
      );
      return;
    case "npm-failed": {
      const outcome =
        error.exitCode !== null
          ? `exit code ${error.exitCode}`
          : `signal ${error.signal ?? "unknown"}`;
      process.stderr.write(
        `error: npm failed with ${outcome}\nhint: resolve the npm error above, then retry or run \`${manual}\`\n`,
      );
      return;
    }
  }
}
