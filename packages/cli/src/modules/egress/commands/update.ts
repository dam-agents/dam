import { Command, Option } from "commander";
import {
  formatEgressRuleInline,
  formatEgressRuleSource,
  gatewayRestartImpact,
} from "api-server-api";
import { gatewayRestartNotice } from "../domain/restart-notice.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RULE_NOT_FOUND,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { confirm, exitCancelled } from "../../shared/prompt.js";
import type { EgressService } from "../services/egress-service.js";

export function buildUpdateCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createEgressService: (host: string) => EgressService;
}): Command {
  return new Command("update")
    .description(
      "Update a network access rule; flips source to 'manual'. Partial — pass only the fields you want to change.",
    )
    .argument("<rule-id>", "Rule UUID (copy from `dam network list`)")
    .option("--method <m>", "new HTTP method")
    .option("--path <p>", "new path pattern")
    .addOption(
      new Option("--verdict <v>", "new verdict").choices(["allow", "deny"]),
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("-y, --yes", "skip the gateway restart confirmation")
    .option("--json", "emit the updated rule as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam network update 3f2a8c0e-... --verdict deny\n" +
        "  dam network update 3f2a8c0e-... --method GET --path /v1/* --yes\n",
    )
    .action(
      async (
        id: string,
        opts: {
          method?: string;
          path?: string;
          verdict?: "allow" | "deny";
          server?: string;
          yes?: boolean;
          json?: boolean;
        },
      ) => {
        if (
          opts.method === undefined &&
          opts.path === undefined &&
          opts.verdict === undefined
        ) {
          process.stderr.write(
            "error: at least one of --method, --path, --verdict must be provided\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const egress = deps.createEgressService(host);
        const current = await egress.get(id);
        if (!current.ok) {
          const failure = current.error;
          if (failure.kind === "rule-not-found") {
            process.stderr.write(
              `error: network access rule not found: ${failure.id}\n`,
            );
            process.exit(EXIT_RULE_NOT_FOUND);
          } else if (failure.kind === "rule-lookup-unsupported") {
            if (!opts.yes) {
              process.stderr.write(
                "error: this server is too old to report whether this change restarts the network gateway; re-run with --yes to apply it anyway\n",
              );
              process.exit(EXIT_INVALID_INPUT);
            }
          } else {
            printServiceError(failure, host);
            process.exit(EXIT_RUNTIME_FAILURE);
          }
        }

        if (current.ok) {
          const rule = current.value;
          const siblings = await egress.listForAgent(rule.agentId);
          if (!siblings.ok) {
            printServiceError(siblings.error, host);
            process.exit(EXIT_RUNTIME_FAILURE);
          }
          const impact = gatewayRestartImpact({
            current: siblings.value,
            removeIds: [id],
            adds: [
              {
                host: rule.host,
                ...(rule.port ? { port: rule.port } : {}),
                method: opts.method ?? rule.method,
                pathPattern: opts.path ?? rule.pathPattern,
                source: "manual",
              },
            ],
          });
          if (impact.willRestart && !opts.yes) {
            if (!process.stdin.isTTY) {
              process.stderr.write(
                "error: this change restarts the network gateway; pass --yes on non-interactive stdin\n",
              );
              process.exit(EXIT_INVALID_INPUT);
            }
            process.stderr.write(gatewayRestartNotice(impact));
            if (!(await confirm("Continue?"))) exitCancelled(opts);
          }
        }

        const result = await egress.update({
          id,
          method: opts.method,
          pathPattern: opts.path,
          verdict: opts.verdict,
        });
        if (!result.ok) {
          if (result.error.kind === "rule-not-found") {
            process.stderr.write(
              `error: network access rule not found: ${result.error.id}\n`,
            );
            process.exit(EXIT_RULE_NOT_FOUND);
          }
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result.value)}\n`);
        } else {
          process.stdout.write(
            `✓ Updated rule ${result.value.id} (${formatEgressRuleInline(result.value)}). Source: ${formatEgressRuleSource(result.value.source)}.\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
