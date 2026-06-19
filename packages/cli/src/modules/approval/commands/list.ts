import { Command, Option } from "commander";
import type { ApprovalListOptions, ApprovalStatus } from "api-server-api";
import { describeApprovalPayload } from "api-server-api";
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
import { formatRelative } from "../../shared/relative-time.js";
import { renderFittedTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import type { ApprovalService } from "../services/approval-service.js";

type StatusFlag = ApprovalStatus | "all";

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createApprovalService: (host: string) => ApprovalService;
}): Command {
  return new Command("list")
    .description(
      "List the HITL approval inbox — requests your Agents are waiting on",
    )
    .argument(
      "[agent]",
      "Agent Ref — name or 'agent-…' ID; omit for all your Agents",
    )
    .addOption(
      new Option(
        "--status <status>",
        "filter by status; 'all' includes resolved and expired",
      )
        .choices(["pending", "resolved", "expired", "all"])
        .default("pending"),
    )
    .option("--limit <n>", "maximum rows (1–500)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam approval list\n" +
        "  dam approval list my-agent --status all\n" +
        "\n`dam network` manages the standing rules (pre-approvals that stop a prompt\nfrom appearing); `dam approval` actions the prompts that did appear.\n",
    )
    .action(
      async (
        ref: string | undefined,
        opts: {
          status: StatusFlag;
          limit?: string;
          server?: string;
          json?: boolean;
        },
      ) => {
        let limit: number | undefined;
        if (opts.limit !== undefined) {
          const n = Number(opts.limit);
          // The contract schema (`limit.max(500)`) rejects > 500 at the tRPC
          // boundary; validate here for a clean exit 2 with a clear message
          // instead of a raw transport error.
          if (!Number.isInteger(n) || n <= 0 || n > 500) {
            process.stderr.write(
              `error: invalid \`--limit\` value \`${opts.limit}\`; expected integer between 1 and 500\n`,
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          limit = n;
        }

        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const listOpts: ApprovalListOptions = {
          ...(opts.status === "all" ? {} : { status: opts.status }),
          ...(limit === undefined ? {} : { limit }),
        };

        const service = deps.createApprovalService(host);
        let result;
        if (ref === undefined) {
          result = await service.listForOwner(listOpts);
        } else {
          const resolver = createAgentResolver({
            agentService: deps.createAgentService(host),
          });
          const resolved = await resolver.resolve(ref);
          if (!resolved.ok) {
            printResolveError(resolved.error, host);
            process.exit(exitCodeForResolveError(resolved.error));
          }
          result = await service.listForInstance(resolved.value.id, listOpts);
        }
        if (!result.ok) {
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify(result.value)}\n`,
            EXIT_SUCCESS,
          );
        }

        if (result.value.length === 0) {
          process.stderr.write(
            opts.status === "pending"
              ? "No pending approvals. Use --status all to include resolved and expired.\n"
              : `No ${opts.status === "all" ? "" : `${opts.status} `}approvals.\n`,
          );
          process.exit(EXIT_SUCCESS);
        }

        // Server row order is kept (newest first). REQUEST is the flex
        // column — it carries a full method/host/path line and is collapsed
        // to fit the terminal width (--json keeps the full text).
        const now = new Date();
        return writeStdoutAndExit(
          renderFittedTable(
            ["ID", "TYPE", "AGENT", "REQUEST", "STATUS", "EXPIRES"],
            result.value.map((row) => {
              const { title, subtitle } = describeApprovalPayload(row.payload);
              return [
                row.id,
                row.type,
                row.agentId,
                title + (subtitle ? ` ${subtitle}` : ""),
                row.status,
                row.status === "pending"
                  ? formatRelative(row.expiresAt, now)
                  : "—",
              ];
            }),
            3,
          ),
          EXIT_SUCCESS,
        );
      },
    );
}
