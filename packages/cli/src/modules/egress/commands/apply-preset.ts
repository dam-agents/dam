import { Command, Option } from "commander";
import type { EgressPreset } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { confirm, exitCancelled } from "../../shared/prompt.js";
import type { EgressService } from "../services/egress-service.js";

export function buildApplyPresetCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createEgressService: (host: string) => EgressService;
}): Command {
  return new Command("apply-preset")
    .description(
      "Replace existing preset rules on the Agent. Manual and connection-derived rules are preserved.",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .addOption(
      new Option("--preset <name>", "preset to apply")
        .choices(["none", "trusted", "all"])
        .makeOptionMandatory(),
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("-y, --yes", "skip the 'all' preset confirmation")
    .option("--json", "emit { ok, agentId, preset } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam network apply-preset my-agent --preset trusted\n" +
        "  dam network apply-preset my-agent --preset all --yes\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          preset: EgressPreset;
          server?: string;
          yes?: boolean;
          json?: boolean;
        },
      ) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const resolver = createAgentResolver({
          agentService: deps.createAgentService(host),
        });
        const resolved = await resolver.resolve(ref);
        if (!resolved.ok) {
          printResolveError(resolved.error, host);
          process.exit(exitCodeForResolveError(resolved.error));
        }

        process.stderr.write(
          `Applying preset '${opts.preset}' will replace existing preset rules. Manual and connection-derived rules are preserved.\n`,
        );

        if (opts.preset === "all" && !opts.yes) {
          if (!process.stdin.isTTY) {
            process.stderr.write(
              "error: --preset all requires --yes on non-interactive stdin\n",
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          process.stderr.write(
            "Preset 'all' allows the agent to reach any host — this is a development escape hatch and bypasses the inbox entirely.\n",
          );
          if (!(await confirm("Continue?"))) exitCancelled(opts);
        }

        const result = await deps
          .createEgressService(host)
          .applyPreset(resolved.value.id, opts.preset);
        if (!result.ok) {
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({
              ok: true,
              agentId: resolved.value.id,
              preset: opts.preset,
            })}\n`,
          );
        } else {
          process.stdout.write(
            `✓ Applied preset '${opts.preset}' to ${ref}. Run \`dam network list ${ref}\` to see the resulting rules.\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
