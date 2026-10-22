// TEST_OVERVIEW: `dam budget` gives platform operators the Operator page's compute budgets from a terminal. `list` asks the server for one page, sorted and found as the flags say, and prints the default, the counts and a table; `set` sends only the fields its flags name, `default` taking a field back to the default, and refuses a value the platform would refuse before it calls the server; `clear` removes a user's budget by email or user id.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserBudgetPage } from "api-server-api";
import { buildBudgetCommand } from "../modules/budget/commands/budget.js";
import type { BudgetService } from "../modules/budget/services/budget-service.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_SUCCESS,
} from "../modules/shared/exit-codes.js";

const ok = <T>(value: T) => ({ ok: true as const, value });

const deps = (svc: Partial<BudgetService>) => ({
  compatService: {
    check: async () =>
      ok({
        kind: "ok" as const,
        localCli: "1.0.0",
        serverVersion: "1.0.0",
        serverMinClient: undefined,
        serverRecommendedClient: undefined,
      }),
  },
  configService: {
    getResolved: async () => ok({ server: "http://localhost:4444" }),
    set: vi.fn(),
  },
  createBudgetService: () => svc as BudgetService,
});

let stdout = "";
let stderr = "";

async function run(
  svc: Partial<BudgetService>,
  args: string[],
  code = EXIT_SUCCESS,
) {
  stdout = "";
  stderr = "";
  await expect(
    buildBudgetCommand(deps(svc)).parseAsync(args, { from: "user" }),
  ).rejects.toThrow(`exit ${code}`);
  return stdout;
}

beforeEach(() => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: unknown, done?: unknown) => {
      stdout += String(chunk);
      if (typeof done === "function") (done as () => void)();
      return true;
    },
  );
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => vi.restoreAllMocks());

const page: UserBudgetPage = {
  defaults: { cpu: "8", memory: "16Gi", storage: "100Gi" },
  total: 40,
  matched: 3,
  offset: 0,
  entries: [
    {
      ownerSub: "sub-ada",
      email: "ada@example.com",
      cpu: "16",
      memory: null,
      storage: null,
      setBySub: "op-1",
      setByEmail: "op@example.com",
      updatedAt: "2026-10-22T12:00:00.000Z",
      reserved: { cpuMilli: 2000, memoryBytes: 4 * 1024 ** 3 },
    },
  ],
};

describe("dam budget", () => {
  it("lists one page as the flags ask, with the default and the counts", async () => {
    const list = vi.fn(async () => ok(page));
    const out = await run({ list }, [
      "list",
      "--find",
      "example",
      "--sort",
      "memory",
      "--limit",
      "10",
    ]);
    expect(list).toHaveBeenCalledWith({
      sort: "memory",
      query: "example",
      limit: 10,
    });
    expect(out).toContain("Default budget: 8 CPU, 16Gi memory, 100Gi storage");
    expect(out).toContain("Showing 1–1 of 3 matches (40 budgets).");
    expect(out).toContain("ada@example.com");
    expect(out).toContain("op@example.com");
  });

  it("refuses an unknown sort before calling the server", async () => {
    const list = vi.fn();
    await run({ list }, ["list", "--sort", "size"], EXIT_INVALID_INPUT);
    expect(list).not.toHaveBeenCalled();
    expect(stderr).toContain("--sort is one of changed, cpu, memory, storage");
  });

  it("sends only the fields its flags name, with default as null", async () => {
    const set = vi.fn(async () => ok(page.entries[0]!));
    const out = await run({ set }, [
      "set",
      "--user",
      "ada@example.com",
      "--cpu",
      "16",
      "--memory",
      "default",
    ]);
    expect(set).toHaveBeenCalledWith({
      user: { email: "ada@example.com" },
      cpu: "16",
      memory: null,
    });
    expect(out).toContain(
      "The compute budget of ada@example.com is now CPU 16, memory default, storage default.",
    );
  });

  it("refuses a zero CPU before calling the server", async () => {
    const set = vi.fn();
    await run(
      { set },
      ["set", "--user", "ada@example.com", "--cpu", "0"],
      EXIT_INVALID_INPUT,
    );
    expect(set).not.toHaveBeenCalled();
    expect(stderr).toContain("more than 0");
  });

  it("clears a budget by user id", async () => {
    const remove = vi.fn(async () => ok({ removed: true }));
    const out = await run({ remove }, ["clear", "--user", "sub-ada"]);
    expect(remove).toHaveBeenCalledWith({ user: { ownerSub: "sub-ada" } });
    expect(out).toContain("sub-ada now has the default compute budget.");
  });
});
