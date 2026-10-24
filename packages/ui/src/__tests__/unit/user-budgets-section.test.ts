// TEST_OVERVIEW: the Operator page's Compute budgets section: the install's default and the total sit above the list; each row names the user, their own CPU, memory and storage with each missing field shown as the default, what their agents reserve now, and who set the budget and when; a budget written outside the platform says so; the list asks the server for its first page by the latest change, and shows a pager only when the matches fill more than one page.
import type { UserBudgetEntry, UserBudgetPage } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const state = vi.hoisted(() => ({
  page: undefined as unknown,
  inputs: [] as unknown[],
}));

vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: Symbol(),
  useQuery: () => ({
    data: state.page,
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
  }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../trpc.js", () => {
  const procedure = (name: string) => ({
    queryOptions: (input: unknown) => {
      state.inputs.push(input);
      return { queryKey: [name, input] };
    },
    mutationOptions: () => ({}),
    queryKey: () => [name],
  });
  return {
    trpc: {
      budgets: {
        reserved: procedure("budgets.reserved"),
        users: {
          list: procedure("budgets.users.list"),
          set: procedure("budgets.users.set"),
          remove: procedure("budgets.users.remove"),
          pathKey: () => ["budgets", "users"],
        },
      },
    },
  };
});
vi.mock("../../query-client.js", () => ({ queryClient: {} }));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));

const { UserBudgetsSection } =
  await import("../../modules/budgets/components/user-budgets-section.js");

function render(page: UserBudgetPage) {
  state.page = page;
  state.inputs = [];
  return renderToStaticMarkup(
    createElement(TooltipProvider, null, createElement(UserBudgetsSection)),
  );
}

const defaults = { cpu: "8", memory: "16Gi", storage: "100Gi" };

function entry(overrides: Partial<UserBudgetEntry>): UserBudgetEntry {
  return {
    ownerSub: "sub-ada",
    email: "ada@example.com",
    cpu: null,
    memory: null,
    storage: null,
    setBySub: "op-1",
    setByEmail: "op@example.com",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("the Compute budgets section", () => {
  // TEST_SCENARIO: a budget that raises only the CPU shows its own CPU and the defaults for memory and storage, so the operator sees what the user really gets.
  it("shows each user's own sizes and the defaults they fall back to", () => {
    const html = render({
      defaults,
      total: 1,
      matched: 1,
      offset: 0,
      entries: [entry({ cpu: "16" })],
    });
    expect(html).toContain(
      "Users without their own budget: 8 CPU, 16Gi memory, 100Gi storage.",
    );
    expect(html).toContain("ada@example.com");
    expect(html).toContain("16 CPU");
    expect(html).toContain("16Gi memory (default)");
    expect(html).toContain("100Gi storage (default)");
    expect(html).toContain("Set by op@example.com");
    expect(state.inputs[0]).toEqual({ sort: "changed", offset: 0, limit: 25 });
  });

  it("says a budget was set outside the platform when it has no record", () => {
    const html = render({
      defaults,
      total: 1,
      matched: 1,
      offset: 0,
      entries: [
        entry({
          memory: "64Gi",
          setBySub: null,
          setByEmail: null,
          updatedAt: null,
        }),
      ],
    });
    expect(html).toContain("Set outside the platform");
  });

  it("leaves storage out on an install without VM agents", () => {
    const html = render({
      defaults: { ...defaults, storage: null },
      total: 1,
      matched: 1,
      offset: 0,
      entries: [entry({ cpu: "4" })],
    });
    expect(html).toContain(
      "Users without their own budget: 8 CPU, 16Gi memory.",
    );
    expect(html).not.toContain("storage (default)");
    expect(html).not.toContain("Most storage");
  });

  it("shows the search, the sort and a pager when the budgets fill more than one page", () => {
    const html = render({
      defaults,
      total: 240,
      matched: 240,
      offset: 0,
      entries: Array.from({ length: 25 }, (_, i) =>
        entry({ ownerSub: `sub-${i}`, email: `user${i}@example.com` }),
      ),
    });
    expect(html).toContain("Find by email or user id");
    expect(html).toContain("Most memory");
    expect(html).toContain("1–25 of 240");
    expect(html).toContain('aria-label="Next page"');
  });

  it("shows no pager when every budget fits on one page", () => {
    const html = render({
      defaults,
      total: 2,
      matched: 2,
      offset: 0,
      entries: [
        entry({}),
        entry({ ownerSub: "sub-bob", email: "bob@example.com" }),
      ],
    });
    expect(html).not.toContain('aria-label="Next page"');
  });

  it("says no user has a budget of their own on a fresh install", () => {
    const html = render({
      defaults,
      total: 0,
      matched: 0,
      offset: 0,
      entries: [],
    });
    expect(html).toContain("No user has a compute budget of their own.");
    expect(html).not.toContain("Find by email or user id");
  });
});
