import { TRPCError } from "@trpc/server";
import type {
  UserBudgetDefaults,
  UserBudgetEntry,
  UserBudgetsService,
  UserBudgetsSort,
  UserBudgetUser,
} from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { parseCpuMilli, parseMemoryBytes } from "../../../core/quantities.js";
import type {
  UserBudgetChange,
  UserBudgetRow,
  UserBudgetSizes,
} from "../infrastructure/user-budgets.js";
import { reservedBy, type BudgetedAgent } from "./budgets-service.js";

export interface BudgetUsers {
  subByEmail(email: string): Promise<string | null>;
  emailsBySub(subs: readonly string[]): Promise<ReadonlyMap<string, string>>;
  subsMatching(query: string, max: number): Promise<ReadonlySet<string>>;
}

export interface UserBudgetStore {
  list(): Promise<UserBudgetRow[]>;
  get(ownerSub: string): Promise<UserBudgetRow | null>;
  write(input: {
    ownerSub: string;
    change: UserBudgetChange;
    setBySub: string;
  }): Promise<{ row: UserBudgetRow | null; from: UserBudgetSizes | null }>;
  remove(ownerSub: string): Promise<UserBudgetSizes | null>;
}

export type UserBudgetsForOperator = (
  operatorSub: string,
) => UserBudgetsService;

type OwnedAgent = BudgetedAgent & { owner?: string };

const NO_RESERVATION = { cpuMilli: 0, memoryBytes: 0 };
const SEARCH_MAX_USERS = 1000;

function reservationsByOwner(
  agents: readonly OwnedAgent[],
): Map<string, { cpuMilli: number; memoryBytes: number }> {
  const byOwner = new Map<string, OwnedAgent[]>();
  for (const agent of agents) {
    if (!agent.owner) continue;
    byOwner.set(agent.owner, [...(byOwner.get(agent.owner) ?? []), agent]);
  }
  return new Map(
    [...byOwner].map(([owner, owned]) => [owner, reservedBy(owned)]),
  );
}

function sortRows(
  rows: UserBudgetRow[],
  sort: UserBudgetsSort,
  defaults: UserBudgetDefaults,
): UserBudgetRow[] {
  const size: Record<
    Exclude<UserBudgetsSort, "changed">,
    (row: UserBudgetRow) => number
  > = {
    cpu: (row) => parseCpuMilli(row.cpu ?? defaults.cpu),
    memory: (row) => parseMemoryBytes(row.memory ?? defaults.memory),
    storage: (row) => parseMemoryBytes(row.storage ?? defaults.storage ?? ""),
  };
  const bySub = (a: UserBudgetRow, b: UserBudgetRow) =>
    a.ownerSub.localeCompare(b.ownerSub);
  if (sort === "changed") {
    return rows.sort(
      (a, b) =>
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || bySub(a, b),
    );
  }
  const of = size[sort];
  return rows.sort((a, b) => of(b) - of(a) || bySub(a, b));
}

// UNIT_BOUNDARY_DESCRIPTION: the operator's view of every user's own compute budget: one page of them at a time, found by part of an email or an account id and sorted by the last change or by a size, with each user's current reservation. Emails are looked up for the page alone, so a large install costs one directory lookup per row shown. A new budget names its user by email, and an account id only reaches a budget that exists, so a typo never creates a budget for nobody.
export function createUserBudgetsAdmin(deps: {
  store: UserBudgetStore;
  users: BudgetUsers;
  listAgents(): Promise<OwnedAgent[]>;
  defaults: UserBudgetDefaults;
}): UserBudgetsForOperator {
  const toEntries = async (
    rows: readonly UserBudgetRow[],
    extraSubs: readonly string[] = [],
  ): Promise<UserBudgetEntry[]> => {
    const [emails, agents] = await Promise.all([
      deps.users.emailsBySub([
        ...new Set([
          ...rows.flatMap((row) =>
            row.setBySub ? [row.ownerSub, row.setBySub] : [row.ownerSub],
          ),
          ...extraSubs,
        ]),
      ]),
      deps.listAgents(),
    ]);
    const reserved = reservationsByOwner(agents);
    return rows.map((row) => ({
      ownerSub: row.ownerSub,
      email: emails.get(row.ownerSub) ?? null,
      cpu: row.cpu,
      memory: row.memory,
      storage: row.storage,
      setBySub: row.setBySub,
      setByEmail: row.setBySub ? (emails.get(row.setBySub) ?? null) : null,
      updatedAt: row.updatedAt,
      reserved: reserved.get(row.ownerSub) ?? NO_RESERVATION,
    }));
  };

  const matching = async (
    rows: UserBudgetRow[],
    query: string | undefined,
  ): Promise<UserBudgetRow[]> => {
    const needle = query?.trim().toLowerCase();
    if (!needle) return rows;
    const subs = await deps.users.subsMatching(needle, SEARCH_MAX_USERS);
    return rows.filter(
      (row) => row.ownerSub.includes(needle) || subs.has(row.ownerSub),
    );
  };

  const subOf = async (user: UserBudgetUser): Promise<string> => {
    if ("ownerSub" in user) return user.ownerSub;
    const sub = await deps.users.subByEmail(user.email);
    if (!sub) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `No user has the email ${user.email}.`,
      });
    }
    return sub;
  };

  const resolveSub = async (user: UserBudgetUser): Promise<string> => {
    if ("ownerSub" in user) {
      if (!(await deps.store.get(user.ownerSub))) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No user with the id ${user.ownerSub} has a budget of their own. Name a new user by their email.`,
        });
      }
      return user.ownerSub;
    }
    return subOf(user);
  };

  return (operatorSub) => ({
    async list({ query, sort, offset, limit }) {
      const all = await deps.store.list();
      const found = sortRows(await matching(all, query), sort, deps.defaults);
      return {
        defaults: deps.defaults,
        total: all.length,
        matched: found.length,
        offset,
        entries: await toEntries(found.slice(offset, offset + limit)),
      };
    },

    async set({ user, ...change }) {
      const ownerSub = await resolveSub(user);
      const { row, from } = await deps.store.write({
        ownerSub,
        change,
        setBySub: operatorSub,
      });
      getLogger().info(
        { operatorSub, ownerSub, from, to: row && sizesOfRow(row) },
        "budgets.user_budget_changed",
      );
      if (!row) return null;
      const [entry] = await toEntries([row], [operatorSub]);
      return entry ?? null;
    },

    async remove({ user }) {
      const ownerSub = await subOf(user);
      const from = await deps.store.remove(ownerSub);
      if (from === null) return { removed: false };
      getLogger().info(
        { operatorSub, ownerSub, from, to: null },
        "budgets.user_budget_changed",
      );
      return { removed: true };
    },
  });
}

function sizesOfRow(row: UserBudgetRow): UserBudgetSizes {
  return { cpu: row.cpu, memory: row.memory, storage: row.storage };
}
