import { Command } from "commander";
import {
  USER_BUDGETS_PAGE_MAX,
  userBudgetSetInputSchema,
  userBudgetsSortSchema,
  type UserBudgetDefaults,
  type UserBudgetEntry,
  type UserBudgetPage,
  type UserBudgetUser,
} from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { BudgetService } from "../services/budget-service.js";

interface BudgetDeps {
  compatService: CompatService;
  configService: ConfigService;
  createBudgetService: (host: string) => BudgetService;
}

interface BudgetOptions {
  user?: string;
  cpu?: string;
  memory?: string;
  storage?: string;
  find?: string;
  sort?: string;
  limit?: string;
  offset?: string;
  server?: string;
  json?: boolean;
}

const USER_OPTION_HELP =
  "the user's email, or the user id that `dam budget list` shows for a user without an email";

const FIELD_HELP = "; `default` removes the field so the default applies";

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(EXIT_INVALID_INPUT);
}

function userOf(text: string | undefined): UserBudgetUser {
  if (text === undefined) fail("pass --user <email>");
  return text.includes("@") ? { email: text } : { ownerSub: text };
}

function fieldOf(text: string | undefined): string | null | undefined {
  if (text === undefined) return undefined;
  return text.trim() === "default" ? null : text;
}

function countOf(text: string | undefined, name: string): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) fail(`--${name} takes a whole number`);
  return n;
}

function defaultsText(defaults: UserBudgetDefaults): string {
  const parts = [`${defaults.cpu} CPU`, `${defaults.memory} memory`];
  if (defaults.storage !== null) parts.push(`${defaults.storage} storage`);
  return parts.join(", ");
}

function sizesText(entry: UserBudgetEntry): string[] {
  return [
    entry.cpu ?? "default",
    entry.memory ?? "default",
    entry.storage ?? "default",
  ];
}

function budgetText(entry: UserBudgetEntry): string {
  const [cpu, memory, storage] = sizesText(entry);
  return `CPU ${cpu}, memory ${memory}, storage ${storage}`;
}

function renderPage(page: UserBudgetPage): string {
  const head = `Default budget: ${defaultsText(page.defaults)}, for every user without their own.`;
  if (page.total === 0) {
    return `${head}\nNo user has a compute budget of their own.\n`;
  }
  if (page.entries.length === 0) {
    return `${head}\nNo budget matches.\n`;
  }
  const shown = `Showing ${page.offset + 1}–${page.offset + page.entries.length} of ${page.matched}${page.matched === page.total ? "" : ` matches (${page.total} budgets)`}.`;
  return (
    `${head}\n${shown}\n\n` +
    renderTable([
      ["USER", "CPU", "MEMORY", "STORAGE", "RESERVED", "SET BY", "CHANGED"],
      ...page.entries.map((entry) => [
        entry.email ?? entry.ownerSub,
        ...sizesText(entry),
        `${entry.reserved.cpuMilli / 1000} CPU, ${(entry.reserved.memoryBytes / 1024 ** 3).toFixed(1)}Gi`,
        entry.setByEmail ?? entry.setBySub ?? "-",
        entry.updatedAt === null
          ? "-"
          : new Date(entry.updatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
      ]),
    ])
  );
}

function withServer(command: Command): Command {
  return command.option(
    "--server <url>",
    "override the configured server URL for this call",
  );
}

function buildListCommand(deps: BudgetDeps): Command {
  return withServer(
    new Command("list")
      .description(
        "List the users with a compute budget of their own, one page at a time, and the default for everyone else (platform operators only)",
      )
      .option("--find <text>", "only budgets whose email or user id holds it")
      .option(
        "--sort <order>",
        `${userBudgetsSortSchema.options.join(", ")} (default changed)`,
      )
      .option(
        "--limit <n>",
        `how many to show, at most ${USER_BUDGETS_PAGE_MAX} (default 25)`,
      )
      .option("--offset <n>", "how many to skip first (default 0)"),
  )
    .option("--json", "emit the page as JSON")
    .action(async (opts: BudgetOptions) => {
      const sort = userBudgetsSortSchema.safeParse(opts.sort ?? "changed");
      if (!sort.success) {
        fail(`--sort is one of ${userBudgetsSortSchema.options.join(", ")}`);
      }
      const limit = countOf(opts.limit, "limit");
      if (limit !== undefined && (limit < 1 || limit > USER_BUDGETS_PAGE_MAX)) {
        fail(`--limit is from 1 to ${USER_BUDGETS_PAGE_MAX}`);
      }
      const host = await resolveActiveHost(deps, opts.server);
      const page = await deps.createBudgetService(host).list({
        sort: sort.data,
        ...(opts.find ? { query: opts.find } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(opts.offset !== undefined
          ? { offset: countOf(opts.offset, "offset") }
          : {}),
      });
      exitOnServiceError(page, host);
      return writeStdoutAndExit(
        opts.json ? `${JSON.stringify(page.value)}\n` : renderPage(page.value),
        EXIT_SUCCESS,
      );
    });
}

function buildSetCommand(deps: BudgetDeps): Command {
  return withServer(
    new Command("set")
      .description(
        "Set or change a user's compute budget. A field you leave out keeps its value (platform operators only)",
      )
      .option("--user <user>", USER_OPTION_HELP)
      .option("--cpu <cores>", `CPU cores, e.g. 16 or 500m${FIELD_HELP}`)
      .option("--memory <size>", `memory, e.g. 32Gi${FIELD_HELP}`)
      .option(
        "--storage <size>",
        `storage of the user's VM machine, e.g. 500Gi${FIELD_HELP}`,
      ),
  )
    .option("--json", "emit the saved budget as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam budget set --user ada@example.com --cpu 16 --memory 32Gi\n" +
        "  dam budget set --user ada@example.com --memory default\n",
    )
    .action(async (opts: BudgetOptions) => {
      const input = userBudgetSetInputSchema.safeParse({
        user: userOf(opts.user),
        cpu: fieldOf(opts.cpu),
        memory: fieldOf(opts.memory),
        storage: fieldOf(opts.storage),
      });
      if (!input.success) {
        fail(input.error.issues[0]?.message ?? "invalid budget");
      }
      const host = await resolveActiveHost(deps, opts.server);
      const saved = await deps.createBudgetService(host).set(input.data);
      exitOnServiceError(saved, host);
      const entry = saved.value;
      if (opts.json) {
        return writeStdoutAndExit(`${JSON.stringify(entry)}\n`, EXIT_SUCCESS);
      }
      const who = opts.user ?? "";
      return writeStdoutAndExit(
        entry === null
          ? `${who} now has the default compute budget.\n`
          : `The compute budget of ${entry.email ?? entry.ownerSub} is now ${budgetText(entry)}.\n`,
        EXIT_SUCCESS,
      );
    });
}

function buildClearCommand(deps: BudgetDeps): Command {
  return withServer(
    new Command("clear")
      .description(
        "Remove a user's own compute budget, so the default applies to them again (platform operators only)",
      )
      .option("--user <user>", USER_OPTION_HELP),
  )
    .option("--json", "emit { removed } as JSON")
    .action(async (opts: BudgetOptions) => {
      const user = userOf(opts.user);
      const host = await resolveActiveHost(deps, opts.server);
      const result = await deps.createBudgetService(host).remove({ user });
      exitOnServiceError(result, host);
      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify(result.value)}\n`,
          EXIT_SUCCESS,
        );
      }
      const who = opts.user ?? "";
      return writeStdoutAndExit(
        result.value.removed
          ? `${who} now has the default compute budget.\n`
          : `${who} had no compute budget of their own.\n`,
        EXIT_SUCCESS,
      );
    });
}

export function buildBudgetCommand(deps: BudgetDeps): Command {
  const budget = new Command("budget").description(
    "List, set or remove each user's compute Budget (platform operators only)",
  );
  budget.addCommand(buildListCommand(deps));
  budget.addCommand(buildSetCommand(deps));
  budget.addCommand(buildClearCommand(deps));
  return budget;
}
