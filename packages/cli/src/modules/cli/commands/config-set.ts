import { Command } from "commander";
import { parseConfigKey } from "../domain/config.js";
import type { DomainError } from "../domain/errors.js";
import type { ConfigService } from "../services/config-service.js";
import { EXIT_INVALID_INPUT, EXIT_RUNTIME_FAILURE } from "./exit-codes.js";

export interface ConfigSetCommandDeps {
  service: ConfigService;
  /** Resolved path used purely for the success message — services keep it
   *  internal otherwise. The command is the only place a user-facing path
   *  matters. */
  configPath: string;
}

export function buildConfigSetCommand(deps: ConfigSetCommandDeps): Command {
  const config = new Command("config").description("Manage CLI configuration");

  config
    .command("set <key> <value>")
    .description("Set a single config key in the CLI config file")
    .action(async (rawKey: string, rawValue: string) => {
      const keyResult = parseConfigKey(rawKey);
      if (!keyResult.ok) {
        printError(keyResult.error);
        process.exit(EXIT_INVALID_INPUT);
      }

      const setResult = await deps.service.set(keyResult.value, rawValue);
      if (!setResult.ok) {
        printError(setResult.error);
        process.exit(
          setResult.error.kind === "invalid-value"
            ? EXIT_INVALID_INPUT
            : EXIT_RUNTIME_FAILURE,
        );
      }

      process.stdout.write(
        `wrote ${keyResult.value} = ${rawValue} to ${deps.configPath}\n`,
      );
    });

  return config;
}

function printError(e: DomainError): void {
  switch (e.kind) {
    case "invalid-key":
      process.stderr.write(
        `error: unknown config key '${e.input}'; valid keys: ${e.validKeys.join(", ")}\n`,
      );
      return;
    case "invalid-value":
      process.stderr.write(
        `error: invalid value for ${e.key}: ${e.reason} (got ${JSON.stringify(e.input)})\n`,
      );
      return;
    case "malformed-config":
      process.stderr.write(`error: ${e.reason}\n`);
      return;
    case "file-write":
      process.stderr.write(`error: cannot write ${e.path}: ${e.reason}\n`);
      return;
    case "missing-config":
      process.stderr.write(`error: required config '${e.key}' is not set\n`);
      return;
  }
}
