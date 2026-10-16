import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { resolveAgentOrExit } from "./errors.js";
import { printServiceError } from "../../shared/trpc/print.js";
import {
  EXIT_AGENT_NOT_RESOLVED,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

type DisableDeps = {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
};

export function buildDisableCommand(
  deps: DisableDeps,
  disabled: boolean,
): Command {
  const verb = disabled ? "disable" : "enable";
  return new Command(verb)
    .description(
      disabled
        ? "Disable an Agent: it sleeps and nothing wakes it until enabled"
        : "Enable a disabled Agent; it wakes on its next use",
    )
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw Agent JSON")
    .addHelpText("after", `\nExamples:\n  dam agent ${verb} my-agent\n`)
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createAgentService(host);
      const agent = await resolveAgentOrExit(svc, ref, host);

      const result = await svc.setDisabled(agent.id, disabled);
      if (!result.ok) {
        if (result.error.kind === "not-found") {
          process.stderr.write(`error: no agent with id \`${agent.id}\`\n`);
          process.exit(EXIT_AGENT_NOT_RESOLVED);
        }
        if (result.error.kind === "runtime-migrating") {
          process.stderr.write(
            `error: agent "${agent.name}" is moving to the new runtime; abort the move to ${verb} it\n`,
          );
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      const listed = disabled && !opts.json ? await svc.list() : null;
      const enableRef =
        PLAIN_NAME.test(agent.name) &&
        listed?.ok &&
        listed.value.filter((a) => a.name === agent.name).length === 1
          ? agent.name
          : agent.id;
      process.stdout.write(
        opts.json
          ? `${JSON.stringify(result.value)}\n`
          : disabled
            ? `✓ Disabled agent "${agent.name}". Nothing wakes it until you run \`dam agent enable ${enableRef}\`.\n`
            : `✓ Enabled agent "${agent.name}". It wakes on its next use.\n`,
      );
      process.exit(EXIT_SUCCESS);
    });
}
