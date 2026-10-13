import { Command } from "commander";
import {
  formatSpendAmount,
  spendLimitAmountTextSchema,
  spendSetLimitInputSchema,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { SpendService } from "../services/spend-service.js";

interface LimitDeps {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSpendService: (host: string) => SpendService;
}

async function setAgentLimit(
  deps: LimitDeps,
  ref: string,
  amountMicros: number | null,
  server: string | undefined,
): Promise<{ id: string; name: string }> {
  const host = await resolveActiveHost(deps, server);
  const agent = await resolveAgentOrExit(
    deps.createAgentService(host),
    ref,
    host,
  );
  const input = spendSetLimitInputSchema.safeParse({
    scope: { kind: "agent", agentId: agent.id },
    amountMicros,
  });
  if (!input.success) {
    process.stderr.write(
      `error: ${input.error.issues[0]?.message ?? "invalid limit"}\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  exitOnServiceError(
    await deps.createSpendService(host).setLimit(input.data),
    host,
  );
  return { id: agent.id, name: agent.name };
}

function buildSetCommand(deps: LimitDeps): Command {
  return new Command("set")
    .description(
      "Set an Agent's daily Spend Limit in US dollars (per UTC day, paid providers)",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .requiredOption("--usd <amount>", "dollars per UTC day, e.g. 10 or 0.25")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, agentId, amountMicros } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam spend limit set my-agent --usd 10\n" +
        "  dam spend limit set my-agent --usd 0.25\n",
    )
    .action(
      async (
        ref: string,
        opts: { usd: string; server?: string; json?: boolean },
      ) => {
        const amount = spendLimitAmountTextSchema.safeParse(opts.usd);
        if (!amount.success) {
          process.stderr.write(
            `error: --usd: ${amount.error.issues[0]?.message ?? "invalid amount"}\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        const agent = await setAgentLimit(deps, ref, amount.data, opts.server);
        return writeStdoutAndExit(
          opts.json
            ? `${JSON.stringify({ ok: true, agentId: agent.id, amountMicros: amount.data })}\n`
            : `The daily Spend Limit of ${agent.name} is now ${formatSpendAmount(amount.data, "usd")} per UTC day.\n`,
          EXIT_SUCCESS,
        );
      },
    );
}

function buildClearCommand(deps: LimitDeps): Command {
  return new Command("clear")
    .description("Remove an Agent's daily Spend Limit")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, agentId } as JSON")
    .addHelpText("after", "\nExample:\n  dam spend limit clear my-agent\n")
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const agent = await setAgentLimit(deps, ref, null, opts.server);
      return writeStdoutAndExit(
        opts.json
          ? `${JSON.stringify({ ok: true, agentId: agent.id })}\n`
          : `${agent.name} has no daily Spend Limit now.\n`,
        EXIT_SUCCESS,
      );
    });
}

export function buildLimitCommand(deps: LimitDeps): Command {
  const limit = new Command("limit").description(
    "Set or remove a daily Spend Limit",
  );
  limit.addCommand(buildSetCommand(deps));
  limit.addCommand(buildClearCommand(deps));
  return limit;
}
