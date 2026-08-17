import { Command, Option } from "commander";
import { formatEgressRuleInline, gatewayRestartImpact } from "api-server-api";
import { gatewayRestartNotice } from "../domain/restart-notice.js";
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

export function buildCreateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createEgressService: (host: string) => EgressService;
}): Command {
  return new Command("create")
    .description("Add a network access rule to an Agent")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .requiredOption("--host <h>", "host the rule applies to")
    .option("--method <m>", "HTTP method; default '*'", "*")
    .option("--path <p>", "path pattern; default '*'", "*")
    .addOption(
      new Option("--verdict <v>", "allow or deny; default 'allow'")
        .choices(["allow", "deny"])
        .default("allow"),
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("-y, --yes", "skip the gateway restart confirmation")
    .option("--json", "emit the created rule as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam network create my-agent --host api.example.com\n" +
        "  dam network create my-agent --host api.example.com --method GET --path /v1/* --yes\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          host: string;
          method: string;
          path: string;
          verdict: "allow" | "deny";
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

        const egress = deps.createEgressService(host);
        if (!opts.yes) {
          const existing = await egress.listForAgent(resolved.value.id);
          if (!existing.ok) {
            printServiceError(existing.error, host);
            process.exit(EXIT_RUNTIME_FAILURE);
          }
          const impact = gatewayRestartImpact({
            current: existing.value,
            adds: [
              {
                host: opts.host,
                method: opts.method,
                pathPattern: opts.path,
                source: "manual",
              },
            ],
          });
          if (impact.willRestart) {
            if (!process.stdin.isTTY) {
              process.stderr.write(
                "error: this rule restarts the network gateway; pass --yes on non-interactive stdin\n",
              );
              process.exit(EXIT_INVALID_INPUT);
            }
            process.stderr.write(gatewayRestartNotice(impact));
            if (!(await confirm("Continue?"))) exitCancelled(opts);
          }
        }

        const result = await egress.create({
          agentId: resolved.value.id,
          host: opts.host,
          method: opts.method,
          pathPattern: opts.path,
          verdict: opts.verdict,
        });
        if (!result.ok) {
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result.value)}\n`);
        } else {
          process.stdout.write(
            `✓ Created rule ${result.value.id} (${formatEgressRuleInline(result.value)}) on ${ref}.\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
