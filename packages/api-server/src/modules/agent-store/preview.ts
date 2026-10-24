import { connectionGrants, inArray, type Db } from "db";
import type { Logger } from "../../core/logger.js";
import type { KubeObject } from "../agents/infrastructure/k8s.js";
import {
  rowsFromResource,
  type AgentRowMapping,
  type AgentStoreDefaults,
} from "./rows.js";

const QUANTITY =
  /^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))))?$/u;

export type Refusal = { id: string; reason: string };

export interface MappedBudget {
  ownerSub: string;
  row: Record<string, unknown> | undefined;
  dropped: string[];
  normalized: string[];
  refusal?: string;
}

export interface AbsorbPreview {
  agents: {
    seen: number;
    importable: number;
    refused: Refusal[];
    dropped: Record<string, number>;
    normalized: Record<string, number>;
  };
  budgets: {
    seen: number;
    importable: number;
    refused: Refusal[];
    dropped: Record<string, number>;
    normalized: Record<string, number>;
  };
  connectionGrants: { onlyInResource: Refusal[]; onlyInDatabase: Refusal[] };
}

export { type AgentStoreDefaults } from "./rows.js";

type Spec = Record<string, unknown>;
type Meta = NonNullable<KubeObject["metadata"]> & {
  creationTimestamp?: string;
  deletionTimestamp?: string;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export function mapBudget(cr: KubeObject): MappedBudget {
  const metadata = (cr.metadata ?? {}) as Meta;
  const spec = (cr.spec ?? {}) as Spec;
  const ownerSub =
    text(spec.owner) ?? (metadata.name ?? "").replace(/^budget-/u, "");
  const dropped: string[] = [];
  const normalized: string[] = [];
  const refuse = (reason: string): MappedBudget => ({
    ownerSub,
    row: undefined,
    dropped,
    normalized,
    refusal: reason,
  });

  if (metadata.deletionTimestamp)
    return refuse("the resource is being deleted");
  if (!ownerSub || ownerSub.length > 246)
    return refuse("the budget names no owner subject the column can hold");

  const quantity = (name: string): string | null | Error => {
    const raw = spec[name];
    if (raw === undefined || raw === null) return null;
    const value = typeof raw === "string" ? raw : JSON.stringify(raw);
    return QUANTITY.test(value)
      ? value
      : new Error(`${name} is not a quantity`);
  };
  const cpu = quantity("cpu");
  const memory = quantity("memory");
  const storage = quantity("storage");
  for (const field of [cpu, memory, storage])
    if (field instanceof Error) return refuse(field.message);
  if (cpu === null && memory === null && storage === null)
    return refuse("the budget carries no override, so it would be deleted");
  if (cr.status !== undefined) dropped.push("status");

  return {
    ownerSub,
    dropped,
    normalized,
    row: {
      ownerSub,
      cpu,
      memory,
      storage,
      setBySub: null,
      operatorUpdatedAt: null,
      createdAt: metadata.creationTimestamp,
      updatedAt: metadata.creationTimestamp,
    },
  };
}

const tally = (fields: string[], into: Record<string, number>): void => {
  for (const field of fields) into[field] = (into[field] ?? 0) + 1;
};

export function previewAgentStore(input: {
  agents: KubeObject[];
  budgets: KubeObject[];
  grants: Array<{ agentId: string; connectionId: string }>;
  defaults: AgentStoreDefaults;
  switchedAt: string;
}): AbsorbPreview {
  const mappedAgents = input.agents.map((cr) =>
    rowsFromResource(cr, input.defaults, input.switchedAt),
  );
  const mappedBudgets = input.budgets.map(mapBudget);

  const grantedOnResource = new Map<string, Set<string>>(
    input.agents.map((cr) => [
      cr.metadata?.name ?? "",
      new Set(
        Array.isArray((cr.spec as Spec | undefined)?.grantedConnectionIds)
          ? ((cr.spec as Spec).grantedConnectionIds as string[])
          : [],
      ),
    ]),
  );
  const grantedInDatabase = new Map<string, Set<string>>();
  for (const grant of input.grants) {
    const set = grantedInDatabase.get(grant.agentId) ?? new Set<string>();
    set.add(grant.connectionId);
    grantedInDatabase.set(grant.agentId, set);
  }

  const onlyInResource: Refusal[] = [];
  const onlyInDatabase: Refusal[] = [];
  for (const id of new Set([
    ...grantedOnResource.keys(),
    ...grantedInDatabase.keys(),
  ])) {
    const resource = grantedOnResource.get(id) ?? new Set<string>();
    const database = grantedInDatabase.get(id) ?? new Set<string>();
    const missingInDatabase = [...resource].filter((one) => !database.has(one));
    const missingOnResource = [...database].filter((one) => !resource.has(one));
    if (missingInDatabase.length > 0)
      onlyInResource.push({
        id,
        reason: `granted only on the resource: ${missingInDatabase.join(", ")}`,
      });
    if (missingOnResource.length > 0)
      onlyInDatabase.push({
        id,
        reason: `granted only in the database: ${missingOnResource.join(", ")}`,
      });
  }

  const counted = (
    maps: Array<{ dropped: string[]; normalized: string[] }>,
    pick: "dropped" | "normalized",
  ) => {
    const into: Record<string, number> = {};
    for (const one of maps) tally(one[pick], into);
    return into;
  };

  return {
    agents: {
      seen: mappedAgents.length,
      importable: mappedAgents.filter((one) => one.refusal === undefined)
        .length,
      refused: mappedAgents
        .filter(
          (one): one is AgentRowMapping & { refusal: string } =>
            one.refusal !== undefined,
        )
        .map((one) => ({ id: one.id, reason: one.refusal })),
      dropped: counted(mappedAgents, "dropped"),
      normalized: counted(mappedAgents, "normalized"),
    },
    budgets: {
      seen: mappedBudgets.length,
      importable: mappedBudgets.filter((one) => one.refusal === undefined)
        .length,
      refused: mappedBudgets
        .filter(
          (one): one is MappedBudget & { refusal: string } =>
            one.refusal !== undefined,
        )
        .map((one) => ({ id: one.ownerSub, reason: one.refusal })),
      dropped: counted(mappedBudgets, "dropped"),
      normalized: counted(mappedBudgets, "normalized"),
    },
    connectionGrants: { onlyInResource, onlyInDatabase },
  };
}

export async function readConnectionGrants(
  db: Db,
  agentIds: string[],
): Promise<Array<{ agentId: string; connectionId: string }>> {
  if (agentIds.length === 0) return [];
  return db
    .select({
      agentId: connectionGrants.agentId,
      connectionId: connectionGrants.connectionId,
    })
    .from(connectionGrants)
    .where(inArray(connectionGrants.agentId, agentIds));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Logs what an absorb would do, and writes nothing.
 *
 * It runs at startup behind a chart value because the report is the operator's
 * evidence that the switch is safe on this install: which records would become
 * rows, which would be refused and why, what the move would drop, and where the
 * connection grants disagree with the database — the one disagreement that
 * changes egress authority. Never fatal: a preview that failed is a separate
 * finding from a platform that cannot boot.
 */
export async function reportAbsorbPreview(input: {
  listCustomObjects: (plural: string) => Promise<KubeObject[]>;
  db: Db;
  logger: Logger;
  defaults: AgentStoreDefaults;
}): Promise<void> {
  try {
    const agents = await input.listCustomObjects("agents");
    const budgets = await input.listCustomObjects("userbudgets");
    const grants = await readConnectionGrants(
      input.db,
      agents.map((cr) => cr.metadata?.name ?? "").filter((id) => id !== ""),
    );
    const preview = previewAgentStore({
      agents,
      budgets,
      grants,
      defaults: input.defaults,
      switchedAt: new Date().toISOString(),
    });
    input.logger.info({ preview }, "agentStore.absorbPreview");
  } catch (cause) {
    input.logger.warn(
      { error: cause instanceof Error ? cause.message : String(cause) },
      "agentStore.absorbPreview.failed",
    );
  }
}
