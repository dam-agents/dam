// TEST_OVERVIEW: the operator's list of users' own compute budgets: one page at a time, sorted by the last change or by a size where a missing field counts as the default, found by part of an email or an account id, with emails looked up for the shown page alone and each user's current reservation beside their budget. Setting a budget names a new user by email and an existing one by id, so a typo never makes a budget for nobody; each change is logged with the operator who made it. Only an operator reaches any of it.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import type {
  UserBudgetChange,
  UserBudgetRow,
} from "../../modules/budgets/infrastructure/user-budgets.js";
import {
  createUserBudgetsAdmin,
  type UserBudgetStore,
} from "../../modules/budgets/services/user-budgets-admin.js";

const DEFAULTS = { cpu: "8", memory: "16Gi", storage: "100Gi" };

const EMAILS: Record<string, string> = {
  ada: "ada@example.com",
  bob: "bob@example.com",
  cyd: "cyd@corp.example",
  "op-1": "op@example.com",
};

function row(
  ownerSub: string,
  sizes: Partial<UserBudgetChange>,
  updatedAt: string | null = null,
): UserBudgetRow {
  return {
    ownerSub,
    cpu: sizes.cpu ?? null,
    memory: sizes.memory ?? null,
    storage: sizes.storage ?? null,
    setBySub: updatedAt ? "op-1" : null,
    updatedAt,
  };
}

function setup(rows: UserBudgetRow[]) {
  const budgets = new Map(rows.map((r) => [r.ownerSub, r]));
  const store: UserBudgetStore = {
    list: async () => [...budgets.values()],
    get: async (sub) => budgets.get(sub) ?? null,
    write: vi.fn(async ({ ownerSub, change, setBySub }) => {
      const before = budgets.get(ownerSub) ?? null;
      const next = {
        ...row(ownerSub, {}),
        ...before,
        ...change,
        setBySub,
        updatedAt: "2026-10-22T12:00:00.000Z",
      };
      budgets.set(ownerSub, next);
      return { row: next, from: before };
    }),
    remove: vi.fn(async (sub) => {
      const before = budgets.get(sub) ?? null;
      budgets.delete(sub);
      return before;
    }),
  };
  const emailsBySub = vi.fn(async (subs: readonly string[]) => {
    return new Map(
      subs.flatMap((s) => (EMAILS[s] ? [[s, EMAILS[s]] as const] : [])),
    );
  });
  const admin = createUserBudgetsAdmin({
    store,
    users: {
      subByEmail: async (email) =>
        Object.entries(EMAILS).find(([, e]) => e === email)?.[0] ?? null,
      emailsBySub,
      subsMatching: async (text) =>
        new Set(
          Object.entries(EMAILS)
            .filter(([, e]) => e.includes(text))
            .map(([s]) => s),
        ),
    },
    listAgents: async () => [
      {
        id: "a1",
        owner: "ada",
        spec: { resources: { limits: { cpu: "2", memory: "4Gi" } } },
        hibernated: false,
        overBudget: false,
      },
      {
        id: "a2",
        owner: "ada",
        spec: { resources: { limits: { cpu: "1", memory: "1Gi" } } },
        hibernated: true,
        overBudget: false,
      },
    ],
    defaults: DEFAULTS,
  })("op-1");
  return { admin, store, emailsBySub, budgets };
}

const page = { sort: "changed" as const, offset: 0, limit: 25 };

describe("operator list of compute budgets", () => {
  it("shows the defaults, the counts and each user's current reservation", async () => {
    const { admin } = setup([row("ada", { cpu: "16" }), row("bob", {})]);
    const list = await admin.list(page);
    expect(list).toMatchObject({ defaults: DEFAULTS, total: 2, matched: 2 });
    expect(list.entries.find((e) => e.ownerSub === "ada")).toMatchObject({
      email: "ada@example.com",
      cpu: "16",
      memory: null,
      reserved: { cpuMilli: 2000, memoryBytes: 4 * 1024 ** 3 },
    });
    expect(list.entries.find((e) => e.ownerSub === "bob")?.reserved).toEqual({
      cpuMilli: 0,
      memoryBytes: 0,
    });
  });

  // TEST_SCENARIO: on a large install the directory is the slow part, so a page asks it for the page's users and their setters, never for every budget.
  it("pages, and looks up emails for the shown page alone", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row(`user-${String(i).padStart(2, "0")}`, { cpu: String(i + 1) }),
    );
    const { admin, emailsBySub } = setup(rows);
    const second = await admin.list({ sort: "cpu", offset: 10, limit: 10 });
    expect(second.total).toBe(30);
    expect(second.offset).toBe(10);
    expect(second.entries.map((e) => e.cpu)).toEqual([
      "20",
      "19",
      "18",
      "17",
      "16",
      "15",
      "14",
      "13",
      "12",
      "11",
    ]);
    expect(emailsBySub).toHaveBeenCalledTimes(1);
    expect(emailsBySub.mock.calls[0]?.[0]).toHaveLength(10);
  });

  it("sorts a field the budget leaves out as the default", async () => {
    const { admin } = setup([
      row("ada", { memory: "8Gi" }),
      row("bob", { cpu: "4" }),
      row("cyd", { memory: "64Gi" }),
    ]);
    const list = await admin.list({ ...page, sort: "memory" });
    expect(list.entries.map((e) => e.ownerSub)).toEqual(["cyd", "bob", "ada"]);
  });

  it("puts the latest change first, and budgets with no record last", async () => {
    const { admin } = setup([
      row("ada", { cpu: "4" }),
      row("bob", { cpu: "4" }, "2026-10-01T00:00:00.000Z"),
      row("cyd", { cpu: "4" }, "2026-10-20T00:00:00.000Z"),
    ]);
    const list = await admin.list(page);
    expect(list.entries.map((e) => e.ownerSub)).toEqual(["cyd", "bob", "ada"]);
  });

  it("finds a user by part of their email or of their account id", async () => {
    const { admin } = setup([
      row("ada", { cpu: "4" }),
      row("bob", { cpu: "4" }),
      row("cyd", { cpu: "4" }),
    ]);
    const byEmail = await admin.list({ ...page, query: "CORP" });
    expect(byEmail).toMatchObject({ total: 3, matched: 1 });
    expect(byEmail.entries.map((e) => e.ownerSub)).toEqual(["cyd"]);
    const byId = await admin.list({ ...page, query: "bo" });
    expect(byId.entries.map((e) => e.ownerSub)).toEqual(["bob"]);
  });
});

describe("operator changes to compute budgets", () => {
  it("sets a new user's budget by email, recording the operator", async () => {
    const { admin, store } = setup([]);
    const entry = await admin.set({
      user: { email: "bob@example.com" },
      memory: "32Gi",
    });
    expect(store.write).toHaveBeenCalledWith({
      ownerSub: "bob",
      change: { memory: "32Gi" },
      setBySub: "op-1",
    });
    expect(entry).toMatchObject({
      email: "bob@example.com",
      memory: "32Gi",
      setByEmail: "op@example.com",
    });
  });

  it("refuses an unknown email", async () => {
    const { admin, store } = setup([]);
    await expect(
      admin.set({ user: { email: "nobody@example.com" }, cpu: "4" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(store.write).not.toHaveBeenCalled();
  });

  it("refuses an account id that has no budget yet", async () => {
    const { admin, store } = setup([]);
    await expect(
      admin.set({ user: { ownerSub: "ada" }, cpu: "4" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(store.write).not.toHaveBeenCalled();
  });

  it("removes a budget by email", async () => {
    const { admin, budgets } = setup([row("bob", { cpu: "4" })]);
    expect(await admin.remove({ user: { email: "bob@example.com" } })).toEqual({
      removed: true,
    });
    expect(budgets.has("bob")).toBe(false);
  });

  it("removes a budget, and says when there was none", async () => {
    const { admin } = setup([row("ada", { cpu: "4" })]);
    expect(await admin.remove({ user: { ownerSub: "ada" } })).toEqual({
      removed: true,
    });
    expect(await admin.remove({ user: { ownerSub: "ada" } })).toEqual({
      removed: false,
    });
  });
});

describe("compute budgets router", () => {
  function caller(isOperator: boolean, keyId?: string) {
    const userBudgets = {
      list: vi.fn(async () => ({
        defaults: DEFAULTS,
        total: 0,
        matched: 0,
        offset: 0,
        entries: [],
      })),
      set: vi.fn(async () => null),
      remove: vi.fn(async () => ({ removed: false })),
    };
    const ctx = {
      userBudgets,
      user: {
        sub: "u",
        preferredUsername: "u",
        scopes: [],
        agentIds: "*",
        isOperator,
        ...(keyId ? { keyId } : {}),
      },
    } as unknown as ApiContext;
    markTermsProven(ctx);
    return { call: appRouter.createCaller(ctx), userBudgets };
  }

  it("refuses every budget action to a user without the operator role", async () => {
    const { call, userBudgets } = caller(false);
    await expect(call.budgets.users.list({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      call.budgets.users.set({ user: { email: "a@example.com" }, cpu: "4" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call.budgets.users.remove({ user: { ownerSub: "ada" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(userBudgets.list).not.toHaveBeenCalled();
    expect(userBudgets.set).not.toHaveBeenCalled();
    expect(userBudgets.remove).not.toHaveBeenCalled();
  });

  it("gives an operator the first page by the latest change", async () => {
    const { call, userBudgets } = caller(true);
    await call.budgets.users.list({});
    expect(userBudgets.list).toHaveBeenCalledWith({
      sort: "changed",
      offset: 0,
      limit: 25,
    });
  });

  it.each([
    ["a zero CPU", { cpu: "0" }],
    ["a negative memory", { memory: "-4Gi" }],
    ["a memory that is not a size", { memory: "lots" }],
    ["a storage without a unit", { storage: "500" }],
    ["no field at all", {}],
  ])("refuses %s before the service", async (_name, change) => {
    const { call, userBudgets } = caller(true);
    await expect(
      call.budgets.users.set({ user: { email: "a@example.com" }, ...change }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(userBudgets.set).not.toHaveBeenCalled();
  });

  it("refuses a page larger than the most one call returns", async () => {
    const { call } = caller(true);
    await expect(
      call.budgets.users.list({ limit: 1000 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
