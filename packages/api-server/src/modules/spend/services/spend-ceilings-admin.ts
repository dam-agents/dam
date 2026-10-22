import { TRPCError } from "@trpc/server";
import type {
  SpendCeilingEntry,
  SpendCeilingsService,
  SpendCeilingUser,
} from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import type {
  SpendCeilingRow,
  SpendCeilingStore,
} from "../infrastructure/spend-ceilings.js";

export interface CeilingUsers {
  subByEmail(email: string): Promise<string | null>;
  emailsBySub(subs: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export type SpendCeilingsForOperator = (
  operatorSub: string,
) => SpendCeilingsService;

function toEntry(
  row: SpendCeilingRow,
  emails: ReadonlyMap<string, string>,
): SpendCeilingEntry {
  return {
    ownerSub: row.ownerSub,
    email: emails.get(row.ownerSub) ?? null,
    amountMicros: row.amountMicros,
    setBySub: row.setBySub,
    setByEmail: emails.get(row.setBySub) ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function byEmailThenSub(a: SpendCeilingEntry, b: SpendCeilingEntry): number {
  if (a.email !== b.email) {
    if (a.email === null) return 1;
    if (b.email === null) return -1;
    return a.email.localeCompare(b.email);
  }
  return a.ownerSub.localeCompare(b.ownerSub);
}

export function createSpendCeilingsAdmin(deps: {
  store: SpendCeilingStore;
  users: CeilingUsers;
  defaultMicros: number | null;
}): SpendCeilingsForOperator {
  const resolveSub = async (
    user: SpendCeilingUser,
    amountMicros: number | null,
  ): Promise<string> => {
    if ("ownerSub" in user) {
      if (amountMicros !== null && !(await deps.store.has(user.ownerSub))) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No user with the id ${user.ownerSub} has a spend ceiling. Name a new user by their email.`,
        });
      }
      return user.ownerSub;
    }
    const sub = await deps.users.subByEmail(user.email);
    if (!sub) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `No user has the email ${user.email}.`,
      });
    }
    return sub;
  };

  return (operatorSub) => ({
    async list() {
      const rows = await deps.store.list();
      const emails = await deps.users.emailsBySub([
        ...new Set(rows.flatMap((row) => [row.ownerSub, row.setBySub])),
      ]);
      return {
        defaultMicros: deps.defaultMicros,
        ceilings: rows.map((row) => toEntry(row, emails)).sort(byEmailThenSub),
      };
    },

    async set({ user, amountMicros }) {
      const ownerSub = await resolveSub(user, amountMicros);
      if (amountMicros === null) {
        const fromMicros = await deps.store.clear(ownerSub);
        if (fromMicros !== null) {
          getLogger().info(
            { operatorSub, ownerSub, fromMicros, toMicros: null },
            "spend.ceiling_changed",
          );
        }
        return null;
      }
      const { row, fromMicros } = await deps.store.upsert({
        ownerSub,
        amountMicros,
        setBySub: operatorSub,
      });
      getLogger().info(
        { operatorSub, ownerSub, fromMicros, toMicros: amountMicros },
        "spend.ceiling_changed",
      );
      return toEntry(
        row,
        await deps.users.emailsBySub([ownerSub, operatorSub]),
      );
    },
  });
}
