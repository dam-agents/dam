import { Command } from "commander";
import {
  formatSpendAmount,
  spendCeilingSetInputSchema,
  spendCeilingUsdTextSchema,
  type SpendCeilingList,
  type SpendCeilingUser,
} from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { SpendService } from "../services/spend-service.js";

interface CeilingDeps {
  compatService: CompatService;
  configService: ConfigService;
  createSpendService: (host: string) => SpendService;
}

interface CeilingOptions {
  user?: string;
  server?: string;
  json?: boolean;
}

const USER_OPTION_HELP =
  "the user's email, or the user id that `dam spend ceiling list` shows for a user without an email";

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(EXIT_INVALID_INPUT);
}

function userOf(text: string | undefined): SpendCeilingUser {
  if (text === undefined) fail("pass --user <email>");
  return text.includes("@") ? { email: text } : { ownerSub: text };
}

function perDay(micros: number): string {
  return `${formatSpendAmount(micros, "usd")} a day`;
}

function defaultLine(defaultMicros: number | null): string {
  return defaultMicros === null
    ? "No default spend ceiling: a user without their own has none."
    : `Default spend ceiling: ${perDay(defaultMicros)}, for every user without their own.`;
}

function renderList(list: SpendCeilingList): string {
  const head = defaultLine(list.defaultMicros);
  if (list.ceilings.length === 0) {
    return `${head}\nNo user has a spend ceiling of their own.\n`;
  }
  return (
    `${head}\n\n` +
    renderTable([
      ["USER", "SPEND CEILING", "SET BY", "CHANGED"],
      ...list.ceilings.map((entry) => [
        entry.email ?? entry.ownerSub,
        perDay(entry.amountMicros),
        entry.setByEmail ?? entry.setBySub,
        new Date(entry.updatedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      ]),
    ])
  );
}

async function saveCeiling(
  deps: CeilingDeps,
  host: string,
  user: SpendCeilingUser,
  amountMicros: number | null,
) {
  const input = spendCeilingSetInputSchema.safeParse({ user, amountMicros });
  if (!input.success) {
    fail(input.error.issues[0]?.message ?? "invalid spend ceiling");
  }
  const saved = await deps.createSpendService(host).setCeiling(input.data);
  exitOnServiceError(saved, host);
  return saved.value;
}

function buildListCommand(deps: CeilingDeps): Command {
  return new Command("list")
    .description(
      "List the users with a spend ceiling of their own, and the default for everyone else (platform operators only)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the default and the ceilings as JSON")
    .action(async (opts: CeilingOptions) => {
      const host = await resolveActiveHost(deps, opts.server);
      const list = await deps.createSpendService(host).listCeilings();
      exitOnServiceError(list, host);
      return writeStdoutAndExit(
        opts.json ? `${JSON.stringify(list.value)}\n` : renderList(list.value),
        EXIT_SUCCESS,
      );
    });
}

function buildSetCommand(deps: CeilingDeps): Command {
  return new Command("set")
    .description(
      "Set a user's spend ceiling: the most US dollars of paid API spend that all their Agents may spend in one UTC day (platform operators only)",
    )
    .argument("<amount>", "dollars per UTC day, e.g. 50 or 12.50")
    .option("--user <user>", USER_OPTION_HELP)
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the saved ceiling as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam spend ceiling set 50 --user ada@example.com\n" +
        "  dam spend ceiling set 0 --user ada@example.com\n",
    )
    .action(async (amountText: string, opts: CeilingOptions) => {
      const amount = spendCeilingUsdTextSchema.safeParse(amountText);
      if (!amount.success) {
        fail(amount.error.issues[0]?.message ?? "invalid amount");
      }
      const user = userOf(opts.user);
      const host = await resolveActiveHost(deps, opts.server);
      const entry = await saveCeiling(deps, host, user, amount.data);
      return writeStdoutAndExit(
        opts.json
          ? `${JSON.stringify(entry)}\n`
          : `The spend ceiling of ${entry?.email ?? entry?.ownerSub} is now ${perDay(amount.data)}. It applies to their next model call.\n`,
        EXIT_SUCCESS,
      );
    });
}

function buildClearCommand(deps: CeilingDeps): Command {
  return new Command("clear")
    .description(
      "Remove a user's own spend ceiling, so the default applies to them again (platform operators only)",
    )
    .option("--user <user>", USER_OPTION_HELP)
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, user } as JSON")
    .action(async (opts: CeilingOptions) => {
      const user = userOf(opts.user);
      const host = await resolveActiveHost(deps, opts.server);
      await saveCeiling(deps, host, user, null);
      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify({ ok: true, user })}\n`,
          EXIT_SUCCESS,
        );
      }
      const list = await deps.createSpendService(host).listCeilings();
      exitOnServiceError(list, host);
      const who = opts.user ?? "";
      return writeStdoutAndExit(
        list.value.defaultMicros === null
          ? `${who} has no spend ceiling now.\n`
          : `${who} now has the default spend ceiling of ${perDay(list.value.defaultMicros)}.\n`,
        EXIT_SUCCESS,
      );
    });
}

export function buildCeilingCommand(deps: CeilingDeps): Command {
  const ceiling = new Command("ceiling").description(
    "List, set or remove each user's Spend Ceiling (platform operators only)",
  );
  ceiling.addCommand(buildListCommand(deps));
  ceiling.addCommand(buildSetCommand(deps));
  ceiling.addCommand(buildClearCommand(deps));
  return ceiling;
}
