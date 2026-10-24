import { createHash } from "node:crypto";
import { dump } from "js-yaml";
import * as age from "age-encryption";
import type { controlUserBudgets } from "db";
import type { KubeObject } from "../agents/infrastructure/k8s.js";
import { resourceFromRows, type AgentRows } from "./rows.js";

export const USER_BUDGET_KIND = "UserBudget";
const SET_BY_KEY = "agent-platform.ai/budget-set-by";
const UPDATED_AT_KEY = "agent-platform.ai/budget-updated-at";

export interface ExportedResource {
  kind: "Agent" | "UserBudget";
  name: string;
  incarnation: string;
  resource: KubeObject;
  yaml: string;
}

export type BudgetRow = typeof controlUserBudgets.$inferSelect;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the rollback's direction of the one mapping: rows
 * back to the custom resources an earlier release reads.
 *
 * It is built from the rows rather than from the switch's archive, because the
 * rows are the state the platform served until the freeze: an Agent created,
 * renamed or re-granted after the switch must come back as it is now, not as it
 * was at the absorb. The incarnation is not written into the object: Kubernetes
 * assigns a new UID on create, which is why the rollback re-points every child
 * to it before the anchors go.
 */
export function exportCrds(input: {
  agents: AgentRows[];
  budgets: BudgetRow[];
}): ExportedResource[] {
  const agents = input.agents.map((rows) => {
    const resource = resourceFromRows(rows);
    delete resource.status;
    if (resource.metadata) {
      const metadata = resource.metadata as Record<string, unknown>;
      delete metadata.uid;
      delete metadata.resourceVersion;
      delete metadata.generation;
      delete metadata.creationTimestamp;
    }
    return {
      kind: "Agent" as const,
      name: rows.agent.id,
      incarnation: rows.agent.incarnation,
      resource,
      yaml: dump(resource, { noRefs: true, lineWidth: -1 }),
    };
  });
  const budgets = input.budgets.map((row) => {
    const annotations: Record<string, string> = {};
    if (row.setBySub !== null) annotations[SET_BY_KEY] = row.setBySub;
    if (row.operatorUpdatedAt !== null)
      annotations[UPDATED_AT_KEY] = row.operatorUpdatedAt.toISOString();
    const resource: KubeObject = {
      apiVersion: "agent-platform.ai/v1",
      kind: USER_BUDGET_KIND,
      metadata: {
        name: `budget-${row.ownerSub}`,
        ...(Object.keys(annotations).length > 0 && { annotations }),
      },
      spec: {
        owner: row.ownerSub,
        ...(row.cpu !== null && { cpu: row.cpu }),
        ...(row.memory !== null && { memory: row.memory }),
        ...(row.storage !== null && { storage: row.storage }),
      },
    };
    return {
      kind: "UserBudget" as const,
      name: `budget-${row.ownerSub}`,
      incarnation: row.ownerSub,
      resource,
      yaml: dump(resource, { noRefs: true, lineWidth: -1 }),
    };
  });
  return [...agents, ...budgets];
}

export function archiveOf(resources: ExportedResource[]): string {
  return resources.map((one) => one.yaml).join("---\n");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: encrypts the operator's copy of the archive to the
 * one age recipient the install names.
 *
 * The plaintext is the custom resources as they were absorbed, which can carry
 * legacy environment values, so it exists only as ciphertext outside the
 * database and is never written to a log, a pod's filesystem or a terminal. The
 * recipient is public, which is why it can live in the chart; the identity is
 * the operator's and never enters the cluster.
 */
export async function encryptToRecipient(
  plaintext: Buffer,
  recipient: string,
): Promise<Buffer> {
  const encrypter = new age.Encrypter();
  encrypter.addRecipient(recipient);
  return Buffer.from(await encrypter.encrypt(plaintext));
}

export function sha256Of(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
