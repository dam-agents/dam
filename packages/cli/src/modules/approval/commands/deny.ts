import { Command } from "commander";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { ApprovalService } from "../services/approval-service.js";
import { printOutcomeAndExit } from "./outcome.js";

export function buildDenyCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createApprovalService: (host: string) => ApprovalService;
}): Command {
  return new Command("deny")
    .description("Deny a pending request from the inbox")
    .argument("<id>", "approval id (copy from `dam approval list`)")
    .option(
      "--once",
      "deny only this held call — the same request shape re-prompts next time",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the raw action outcome as JSON")
    .addHelpText(
      "after",
      "\nBare `deny` is durable: for a network (ext_authz) request it writes a\npermanent deny rule — future requests of that shape are blocked without\nprompting, and the rule appears in `dam network list <agent>`. Use --once to\ndeny only the held call. Tool-call (acp_native) denials never write an egress\nrule; the verdict goes to the harness.\n",
    )
    .action(
      async (
        id: string,
        opts: { once?: boolean; server?: string; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, opts.server);

        const service = deps.createApprovalService(host);
        const result = await (opts.once
          ? service.dismiss(id)
          : service.denyForever(id));
        exitOnServiceError(result, host);

        printOutcomeAndExit(result.value, opts, {
          pastTense: "Denied",
          onceLine: "Denied this call only — re-prompts next time.",
          expiredEffect: "future requests of this shape are blocked.",
        });
      },
    );
}
