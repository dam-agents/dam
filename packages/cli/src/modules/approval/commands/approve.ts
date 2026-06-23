import { Command } from "commander";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { ApprovalService } from "../services/approval-service.js";
import { printOutcomeAndExit } from "./outcome.js";

export function buildApproveCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createApprovalService: (host: string) => ApprovalService;
}): Command {
  return new Command("approve")
    .description("Approve a pending request from the inbox")
    .argument("<id>", "approval id (copy from `dam approval list`)")
    .option(
      "--once",
      "allow only this held call — the same request shape re-prompts next time",
    )
    .option(
      "--entire-host",
      "allow the entire host (any method, any path); network requests only",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the raw action outcome as JSON")
    .addHelpText(
      "after",
      "\nBare `approve` is durable: for a network (ext_authz) request it writes a\npermanent allow rule — egress to that host/method/path stays open and the rule\nappears in `dam network list <agent>`. Use --once to allow only the held call.\nTool-call (acp_native) approvals never write an egress rule; the harness owns\nits own permission persistence, and --entire-host falls back to the durable approve.\n",
    )
    .action(
      async (
        id: string,
        opts: {
          once?: boolean;
          entireHost?: boolean;
          server?: string;
          json?: boolean;
        },
      ) => {
        if (opts.once && opts.entireHost) {
          process.stderr.write(
            "error: --once and --entire-host are mutually exclusive\n",
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

        const service = deps.createApprovalService(host);
        const result = await (opts.once
          ? service.approveOnce(id)
          : opts.entireHost
            ? service.approveHost(id)
            : service.approvePermanent(id));
        if (!result.ok) {
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        printOutcomeAndExit(result.value, opts, {
          pastTense: "Approved",
          onceLine:
            "Approved this call only — the same request shape will re-prompt next time.",
          expiredEffect: "the next request of this shape passes.",
        });
      },
    );
}
