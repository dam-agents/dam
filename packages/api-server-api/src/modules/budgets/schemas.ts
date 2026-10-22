import { z } from "zod";

export const storageFullSchema = z.object({
  usedBytes: z.number().nonnegative(),
  usableBytes: z.number().nonnegative(),
  percent: z.number().int().min(0),
});

export const USER_BUDGETS_PAGE_MAX = 100;

const POSITIVE = (v: string) => Number.parseFloat(v) > 0;

export const budgetCpuSchema = z
  .string()
  .trim()
  .regex(
    /^(\d+(\.\d{1,3})?|\d+m)$/,
    "a CPU amount looks like 8, 2.5 or 500m",
  )
  .refine(POSITIVE, "a CPU amount must be more than 0");

export const budgetSizeSchema = z
  .string()
  .trim()
  .regex(
    /^\d+(\.\d{1,3})?(Ki|Mi|Gi|Ti|k|M|G|T)$/,
    "a size looks like 16Gi or 512Mi",
  )
  .refine(POSITIVE, "a size must be more than 0");

export const userBudgetsSortSchema = z.enum([
  "changed",
  "cpu",
  "memory",
  "storage",
]);

export const userBudgetsListInputSchema = z.object({
  query: z.string().trim().max(254).optional(),
  sort: userBudgetsSortSchema.default("changed"),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(USER_BUDGETS_PAGE_MAX).default(25),
});

export const userBudgetUserSchema = z.union([
  z.object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  }),
  z.object({ ownerSub: z.string().min(1) }),
]);

// UNIT_BOUNDARY_DESCRIPTION: a change to one user's budget, field by field: a value sets the field, null takes it back to the default, and a field left out keeps what the budget has.
export const userBudgetSetInputSchema = z
  .object({
    user: userBudgetUserSchema,
    cpu: budgetCpuSchema.nullable().optional(),
    memory: budgetSizeSchema.nullable().optional(),
    storage: budgetSizeSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.cpu !== undefined ||
      input.memory !== undefined ||
      input.storage !== undefined,
    "name the CPU, the memory or the storage to set",
  );

export const userBudgetRemoveInputSchema = z.object({
  ownerSub: z.string().min(1),
});
