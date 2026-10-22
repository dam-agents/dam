import { Command } from "commander";
import {
  connectionLimitRefusal,
  connectionLimitRule,
  formatSpendAmount,
  spendLimitAmountTextSchema,
  spendSetLimitInputSchema,
  type SpendLimitScope,
  type SpendUnit,
} from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  resolveConnectionRef,
  type ConnectionService,
} from "../../connection/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { SpendService } from "../services/spend-service.js";

interface LimitDeps {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
  createSpendService: (host: string) => SpendService;
}

interface ScopeOptions {
  me?: boolean;
  connection?: string;
  server?: string;
  json?: boolean;
}

interface LimitTarget {
  scope: SpendLimitScope;
  unit: SpendUnit;
  refusal: string | null;
  setText: (amount: string) => string;
  clearText: string;
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(EXIT_INVALID_INPUT);
}

async function resolveConnection(
  deps: LimitDeps,
  host: string,
  ref: string,
): Promise<{
  id: string;
  name: string;
  unit: SpendUnit;
  refusal: string | null;
}> {
  const connections = await deps.createConnectionService(host).list();
  exitOnServiceError(connections, host);
  const connection = resolveConnectionRef(connections.value, ref);
  if (!connection) {
    process.stderr.write(
      `error: unknown connection id or name: ${ref}\n` +
        "hint: run `dam connection list` to see ids and names\n",
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  const rule = connectionLimitRule(connection.templateId);
  return {
    id: connection.id,
    name: connection.name,
    unit: rule.limitable ? rule.unit : "usd",
    refusal: rule.limitable ? null : connectionLimitRefusal(rule),
  };
}

async function resolveTarget(
  deps: LimitDeps,
  host: string,
  ref: string | undefined,
  opts: ScopeOptions,
): Promise<LimitTarget> {
  if (opts.me) {
    if (ref !== undefined) fail("--me takes no agent");
    if (opts.connection !== undefined) {
      const connection = await resolveConnection(deps, host, opts.connection);
      return {
        scope: { kind: "owner-connection", connectionId: connection.id },
        unit: connection.unit,
        refusal: connection.refusal,
        setText: (amount) =>
          `Your ${connection.name} spend limit (all Agents) is now ${amount} a day.`,
        clearText: `Your ${connection.name} spend limit (all Agents) is removed.`,
      };
    }
    return {
      scope: { kind: "owner" },
      unit: "usd",
      refusal: null,
      setText: (amount) =>
        `Your spend limit (all Agents) is now ${amount} a day. It counts paid API spend only.`,
      clearText: "Your spend limit (all Agents) is removed.",
    };
  }
  if (ref === undefined) fail("name an Agent, or pass --me");
  const agent = await resolveAgentOrExit(
    deps.createAgentService(host),
    ref,
    host,
  );
  if (opts.connection === undefined) {
    return {
      scope: { kind: "agent", agentId: agent.id },
      unit: "usd",
      refusal: null,
      setText: (amount) =>
        `The Agent spend limit of ${agent.name} is now ${amount} a day. It counts paid API spend only: the Claude subscription and Bob need a Connection limit (--connection), for this Agent or for all your Agents (--me).`,
      clearText: `${agent.name} has no Agent spend limit now.`,
    };
  }
  const connection = await resolveConnection(deps, host, opts.connection);
  return {
    scope: {
      kind: "connection",
      agentId: agent.id,
      connectionId: connection.id,
    },
    unit: connection.unit,
    refusal: connection.refusal,
    setText: (amount) =>
      `The ${connection.name} spend limit of ${agent.name} is now ${amount} a day.`,
    clearText: `${agent.name} has no ${connection.name} spend limit now.`,
  };
}

async function saveLimit(
  deps: LimitDeps,
  host: string,
  scope: SpendLimitScope,
  amountMicros: number | null,
): Promise<void> {
  const input = spendSetLimitInputSchema.safeParse({ scope, amountMicros });
  if (!input.success) {
    fail(input.error.issues[0]?.message ?? "invalid limit");
  }
  exitOnServiceError(
    await deps.createSpendService(host).setLimit(input.data),
    host,
  );
}

function parseAmount(flag: string, text: string): number {
  const amount = spendLimitAmountTextSchema.safeParse(text);
  if (!amount.success) {
    fail(`${flag}: ${amount.error.issues[0]?.message ?? "invalid amount"}`);
  }
  return amount.data;
}

function buildSetCommand(deps: LimitDeps): Command {
  return new Command("set")
    .description(
      "Set a daily spend limit: for one Agent or for all your Agents (--me), in US dollars of paid API spend; or on one Connection (--connection), for one Agent or for all your Agents (--me), in that Connection's unit. The Claude subscription and Bob count only in a Connection limit.",
    )
    .argument("[agent]", "Agent Ref — name or 'agent-…' ID")
    .option("--me", "set your own limit for all your Agents together")
    .option(
      "--connection <id-or-name>",
      "set the limit of the Agent's calls on this Connection; with --me, of all your Agents' calls on it",
    )
    .option("--usd <amount>", "dollars per UTC day, e.g. 10 or 0.25")
    .option(
      "--amount <amount>",
      "with --connection: the limit in the Connection's unit (US dollars, subscription value in US dollars, or Bobcoins)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, scope, amountMicros, unit } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam spend limit set my-agent --usd 10\n" +
        "  dam spend limit set --me --usd 50\n" +
        "  dam spend limit set my-agent --connection bob --amount 0.5\n" +
        "  dam spend limit set --me --connection anthropic --amount 20\n",
    )
    .action(
      async (
        ref: string | undefined,
        opts: ScopeOptions & { usd?: string; amount?: string },
      ) => {
        const viaConnection = opts.connection !== undefined;
        if (viaConnection && opts.amount === undefined) {
          fail("--connection takes --amount <amount>, not --usd");
        }
        if (!viaConnection && opts.usd === undefined) {
          fail("pass --usd <amount>");
        }
        if (!viaConnection && opts.amount !== undefined) {
          fail("--amount goes with --connection; use --usd");
        }
        const amountMicros = viaConnection
          ? parseAmount("--amount", opts.amount ?? "")
          : parseAmount("--usd", opts.usd ?? "");
        const host = await resolveActiveHost(deps, opts.server);
        const target = await resolveTarget(deps, host, ref, opts);
        if (target.refusal) fail(target.refusal);
        await saveLimit(deps, host, target.scope, amountMicros);
        return writeStdoutAndExit(
          opts.json
            ? `${JSON.stringify({ ok: true, scope: target.scope, amountMicros, unit: target.unit })}\n`
            : `${target.setText(formatSpendAmount(amountMicros, target.unit))}\n`,
          EXIT_SUCCESS,
        );
      },
    );
}

function buildClearCommand(deps: LimitDeps): Command {
  return new Command("clear")
    .description(
      "Remove a daily spend limit: an Agent's, yours for all your Agents (--me), or a limit on one Connection (--connection), for one Agent or for all your Agents (--me)",
    )
    .argument("[agent]", "Agent Ref — name or 'agent-…' ID")
    .option("--me", "remove your own limit for all your Agents together")
    .option(
      "--connection <id-or-name>",
      "remove the limit of the Agent's calls on this Connection; with --me, of all your Agents' calls on it",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, scope } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam spend limit clear my-agent\n" +
        "  dam spend limit clear --me\n" +
        "  dam spend limit clear my-agent --connection bob\n" +
        "  dam spend limit clear --me --connection anthropic\n",
    )
    .action(async (ref: string | undefined, opts: ScopeOptions) => {
      const host = await resolveActiveHost(deps, opts.server);
      const target = await resolveTarget(deps, host, ref, opts);
      await saveLimit(deps, host, target.scope, null);
      return writeStdoutAndExit(
        opts.json
          ? `${JSON.stringify({ ok: true, scope: target.scope })}\n`
          : `${target.clearText}\n`,
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
