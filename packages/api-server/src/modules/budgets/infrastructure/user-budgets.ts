import { TRPCError } from "@trpc/server";
import {
  isConflict,
  isNotFound,
  type K8sClient,
  type KubeObject,
} from "../../agents/infrastructure/k8s.js";
import type { CeilingOverride } from "../services/budgets-service.js";

const USERBUDGETS_PLURAL = "userbudgets";
const KIND_USER_BUDGET = "UserBudget";
const SET_BY_KEY = "agent-platform.ai/budget-set-by";
const UPDATED_AT_KEY = "agent-platform.ai/budget-updated-at";

export interface UserBudgetSizes {
  cpu: string | null;
  memory: string | null;
  storage: string | null;
}

export interface UserBudgetRow extends UserBudgetSizes {
  readonly ownerSub: string;
  readonly setBySub: string | null;
  readonly updatedAt: string | null;
}

export type UserBudgetChange = Partial<UserBudgetSizes>;

const budgetName = (owner: string) => `budget-${owner}`;

export async function readUserBudgetSizes(
  k8s: K8sClient,
  owner: string,
): Promise<UserBudgetSizes> {
  return sizesOf(
    await k8s.getCustomObject(USERBUDGETS_PLURAL, budgetName(owner)),
  );
}

export async function readUserBudgetCeiling(
  k8s: K8sClient,
  owner: string,
): Promise<CeilingOverride | null> {
  const { cpu, memory } = await readUserBudgetSizes(k8s, owner);
  if (cpu === null && memory === null) return null;
  return {
    ...(cpu !== null && { cpu }),
    ...(memory !== null && { memory }),
  };
}

export async function listUserBudgets(
  k8s: K8sClient,
): Promise<UserBudgetRow[]> {
  const objs = await k8s.listCustomObjects(USERBUDGETS_PLURAL);
  return objs.flatMap((obj) => {
    const row = rowOf(obj);
    return row ? [row] : [];
  });
}

export async function readUserBudget(
  k8s: K8sClient,
  owner: string,
): Promise<UserBudgetRow | null> {
  const obj = await k8s.getCustomObject(USERBUDGETS_PLURAL, budgetName(owner));
  return obj ? rowOf(obj) : null;
}

// UNIT_BOUNDARY_DESCRIPTION: writes one user's UserBudget the way an operator asked: a value sets a field, null drops it so the default applies again, and a field left out is kept. A budget left with no field is deleted, since it would only repeat the defaults. Who wrote it and when go on its annotations, the record a budget written with kubectl does not have. The cluster's own validation, such as an owner id it cannot name an object after, comes back as BAD_REQUEST.
export async function writeUserBudget(
  k8s: K8sClient,
  input: { ownerSub: string; change: UserBudgetChange; setBySub: string },
): Promise<{ row: UserBudgetRow | null; from: UserBudgetSizes | null }> {
  const name = budgetName(input.ownerSub);
  const before = await k8s.getCustomObject(USERBUDGETS_PLURAL, name);
  const from = before ? sizesOf(before) : null;
  const next = { ...emptySizes(), ...from, ...input.change };
  if (next.cpu === null && next.memory === null && next.storage === null) {
    if (before) await k8s.deleteCustomObject(USERBUDGETS_PLURAL, name);
    return { row: null, from };
  }
  const annotations = {
    [SET_BY_KEY]: input.setBySub,
    [UPDATED_AT_KEY]: new Date().toISOString(),
  };
  try {
    const written = before
      ? await k8s.patchCustomObject(USERBUDGETS_PLURAL, name, {
          metadata: { annotations },
          spec: input.change,
        })
      : await createOrPatch(k8s, name, input, next, annotations);
    return { row: rowOf(written), from };
  } catch (err) {
    throw refusalOf(err) ?? err;
  }
}

export async function deleteUserBudget(
  k8s: K8sClient,
  owner: string,
): Promise<UserBudgetSizes | null> {
  const name = budgetName(owner);
  const before = await k8s.getCustomObject(USERBUDGETS_PLURAL, name);
  if (!before) return null;
  await k8s.deleteCustomObject(USERBUDGETS_PLURAL, name);
  return sizesOf(before);
}

async function createOrPatch(
  k8s: K8sClient,
  name: string,
  input: { ownerSub: string; change: UserBudgetChange },
  next: UserBudgetSizes,
  annotations: Record<string, string>,
): Promise<KubeObject> {
  try {
    return await k8s.createCustomObject(USERBUDGETS_PLURAL, {
      apiVersion: "agent-platform.ai/v1",
      kind: KIND_USER_BUDGET,
      metadata: { name, annotations },
      spec: {
        owner: input.ownerSub,
        ...(next.cpu !== null && { cpu: next.cpu }),
        ...(next.memory !== null && { memory: next.memory }),
        ...(next.storage !== null && { storage: next.storage }),
      },
    });
  } catch (err) {
    if (!isConflict(err)) throw err;
    return k8s.patchCustomObject(USERBUDGETS_PLURAL, name, {
      metadata: { annotations },
      spec: input.change,
    });
  }
}

function refusalOf(err: unknown): TRPCError | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (isNotFound(err)) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "This budget was removed meanwhile.",
    });
  }
  if (code !== 422 && code !== 400) return null;
  return new TRPCError({
    code: "BAD_REQUEST",
    message: `The cluster refused this budget: ${statusMessage(err)}`.trim(),
  });
}

function statusMessage(err: unknown): string {
  const body = (err as { body?: unknown }).body;
  if (typeof body !== "string") {
    return (body as { message?: string } | undefined)?.message ?? "";
  }
  try {
    return (JSON.parse(body) as { message?: string }).message ?? body;
  } catch {
    return body;
  }
}

function rowOf(obj: KubeObject): UserBudgetRow | null {
  const owner = (obj.spec as { owner?: unknown } | undefined)?.owner;
  if (typeof owner !== "string" || owner === "") return null;
  const annotations = obj.metadata?.annotations ?? {};
  return {
    ownerSub: owner,
    ...sizesOf(obj),
    setBySub: annotations[SET_BY_KEY] ?? null,
    updatedAt: annotations[UPDATED_AT_KEY] ?? null,
  };
}

function sizesOf(obj: KubeObject | null): UserBudgetSizes {
  const spec = (
    obj as {
      spec?: { cpu?: unknown; memory?: unknown; storage?: unknown };
    } | null
  )?.spec;
  return {
    cpu: quantityString(spec?.cpu),
    memory: quantityString(spec?.memory),
    storage: quantityString(spec?.storage),
  };
}

function emptySizes(): UserBudgetSizes {
  return { cpu: null, memory: null, storage: null };
}

function quantityString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
