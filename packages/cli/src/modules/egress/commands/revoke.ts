import { Command } from "commander";
import { gatewayRestartImpact } from "api-server-api";
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
import { gatewayRestartNotice } from "../domain/restart-notice.js";
import type { EgressService } from "../services/egress-service.js";

export function buildRevokeCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createEgressService: (host: string) => EgressService;
}): Command {
  return new Command("revoke")
    .description(
      "Delete a network access rule. Idempotent — unknown IDs exit 0.",
    )
    .argument("<rule-id>", "Rule UUID (copy from `dam network list`)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("-y, --yes", "skip the gateway restart confirmation")
    .option("--json", "emit { ok, id } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam network revoke 3f2a8c0e-2b91-4d6a-9c1b-7e8a1f0a2b3c\n",
    )
    .action(
      async (
        id: string,
        opts: { server?: string; yes?: boolean; json?: boolean },
      ) => {
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
          if (failure.kind === "rule-lookup-unsupported") {
            if (!opts.yes) {
              process.stderr.write(
                "error: this server is too old to report whether revoking restarts the network gateway; re-run with --yes to revoke anyway\n",
              );
              process.exit(EXIT_INVALID_INPUT);
            }
          } else if (failure.kind !== "rule-not-found") {
            printServiceError(failure, host);
            process.exit(EXIT_RUNTIME_FAILURE);
          }
        }
        if (current.ok) {
          const siblings = await egress.listForAgent(current.value.agentId);
          if (!siblings.ok) {
            printServiceError(siblings.error, host);
            process.exit(EXIT_RUNTIME_FAILURE);
          }
          const impact = gatewayRestartImpact({
            current: siblings.value,
            removeIds: [id],
          });
          if (impact.willRestart && !opts.yes) {
            if (!process.stdin.isTTY) {
              process.stderr.write(
                "error: this revoke restarts the network gateway; pass --yes on non-interactive stdin\n",
              );
              process.exit(EXIT_INVALID_INPUT);
            }
            process.stderr.write(gatewayRestartNotice(impact));
            if (!(await confirm("Continue?"))) exitCancelled(opts);
          }
        }

        const result = await egress.revoke(id);
        if (!result.ok) {
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ ok: true, id })}\n`);
        } else {
          process.stdout.write(`✓ Revoked rule ${id}.\n`);
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
