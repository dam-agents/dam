import type { AgentSpecCR } from "api-server-api";
import { pathSafe } from "../../secret-store/domain/ref-path.js";
import {
  LABEL_OWNER,
  LABEL_TEMPLATE_REF,
} from "../../agents/infrastructure/labels.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads what an install kept in the Kubernetes API
 * and produces the rows that replace it. Pure: the caller fetches the
 * resources and writes the rows, so the shape of the conversion can be checked
 * without a cluster or a database.
 *
 * Three kinds move — the agent definitions, the credential bytes, and the
 * per-user budget ceilings — and only these three, because everything else the
 * platform owned was already in Postgres and migrates in place.
 *
 * A credential keeps its name and changes its address. Grants are recorded by
 * name, so re-homing a secret under its owner leaves every agent's grant list
 * meaning what it meant before; what has to be rewritten is every reference
 * that carries a whole address — the registry credential an agent pulls with,
 * and the refs a connection holds in the row Postgres already had. Those rows
 * migrate in place and so are easy to assume are finished, but each one names
 * the store that minted it, and that store is gone: left alone, a connection
 * survives the move intact and fails at its first upstream call.
 *
 * Only the platform's own annotations come across. The rest of what sits
 * beside them belongs to Kubernetes and to whatever applied the resource —
 * `kubectl apply` alone parks a copy of the entire manifest there — and none
 * of it means anything to a reader of the agent record.
 *
 * A credential is carried as text, and refused rather than mangled if it is
 * not. A Secret's data is bytes; this store's is a string map. Decoding bytes
 * that are not valid UTF-8 does not fail, it substitutes — so a binary
 * credential would arrive looking imported, work nowhere, and have no original
 * left to compare against, the cluster being gone. Nothing the platform mints
 * today is binary, which is exactly why the day one is would go unnoticed.
 *
 * Observed state is deliberately dropped. A restart count and a readiness
 * condition describe a pod that will not exist after this runs, and the
 * supervisor republishes both from what it finds within one reconcile —
 * importing them would only mean carrying an opinion that is already wrong.
 */
const SECRET_STORE_ID = "pg";
const PLATFORM_PREFIX = "agent-platform.ai/";

export interface K8sObject {
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  data?: Record<string, string>;
}

export interface AgentRecordRow {
  id: string;
  owner: string;
  templateId: string | null;
  annotations: Record<string, string>;
  spec: AgentSpecCR;
}

export interface SecretRow {
  storeId: string;
  path: string;
  owner: string;
  purpose: string;
  metadata: Record<string, unknown>;
  fields: Record<string, string>;
}

export interface BudgetRow {
  owner: string;
  cpu: string;
  memory: string;
}

export const secretPathFor = (owner: string, name: string) =>
  `${pathSafe(owner)}/${name}`;

export function agentRecordFromCr(cr: K8sObject): AgentRecordRow {
  const id = cr.metadata?.name;
  const owner = cr.metadata?.labels?.[LABEL_OWNER];
  if (!id || !owner) {
    throw new Error(
      `agent ${JSON.stringify(id ?? "<unnamed>")} has no owner label; refusing to guess`,
    );
  }
  const src = (cr.spec ?? {}) as Record<string, unknown>;
  const pull = src.imagePullSecretRef;
  const spec: AgentSpecCR = {
    image: String(src.image ?? ""),
    ...pick(src, [
      "agentHome",
      "description",
      "env",
      "grantedConnectionIds",
      "grantedSecretIds",
      "hibernationTimeout",
      "imagePullPolicy",
      "init",
      "name",
      "resources",
      "secretRef",
      "telemetryAttributionId",
    ]),
    ...(typeof pull === "string" && pull
      ? {
          registryAuth: {
            storeId: SECRET_STORE_ID,
            path: secretPathFor(owner, pull),
            field: "",
          },
        }
      : {}),
  };
  return {
    id,
    owner,
    templateId: cr.metadata?.labels?.[LABEL_TEMPLATE_REF] ?? null,
    annotations: Object.fromEntries(
      Object.entries(cr.metadata?.annotations ?? {}).filter(([k]) =>
        k.startsWith(PLATFORM_PREFIX),
      ),
    ),
    spec,
  };
}

export function secretRowFromK8s(secret: K8sObject): SecretRow {
  const name = secret.metadata?.name;
  const labels = secret.metadata?.labels ?? {};
  const owner = labels[LABEL_OWNER];
  if (!name || !owner) {
    throw new Error(
      `secret ${JSON.stringify(name ?? "<unnamed>")} has no owner label; refusing to guess`,
    );
  }
  const purposeLabel = "agent-platform.ai/secret-purpose";
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(secret.data ?? {})) {
    const bytes = Buffer.from(v, "base64");
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      throw new Error(
        `secret ${JSON.stringify(name)} field ${JSON.stringify(k)} is not text; importing it would corrupt it`,
      );
    }
    fields[k] = text;
  }
  const extraLabels = Object.fromEntries(
    Object.entries(labels).filter(
      ([k]) => k !== LABEL_OWNER && k !== "agent-platform.ai/managed-by",
    ),
  );
  return {
    storeId: SECRET_STORE_ID,
    path: secretPathFor(owner, name),
    owner,
    purpose:
      secret.metadata?.annotations?.[purposeLabel] ??
      labels[purposeLabel] ??
      "unknown",
    metadata: { extraLabels },
    fields,
  };
}

export function budgetRowFromCr(cr: K8sObject): BudgetRow {
  const src = (cr.spec ?? {}) as Record<string, unknown>;
  const owner = typeof src.owner === "string" ? src.owner : "";
  if (!owner) throw new Error("user budget has no owner; refusing to guess");
  return {
    owner,
    cpu: String(src.cpu ?? ""),
    memory: String(src.memory ?? ""),
  };
}

function pick(
  src: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Re-addresses the credential references a row
 * already in Postgres carries. A connection holds several — the value, and for
 * an OAuth one the tokens and client secret — at whatever depth its kind puts
 * them, so this walks the value rather than naming fields that would have to
 * be kept in step with every connection template.
 *
 * Only a reference to a secret this migration actually moved is rewritten. One
 * naming something else is left exactly as it is: it is not ours to guess at,
 * and a wrong address that still reads like one is worse than the old one.
 */
export function rehomeRefs(
  value: unknown,
  moved: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) return value.map((v) => rehomeRefs(v, moved));
  if (value === null || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  const path = node.path;
  if (typeof node.storeId === "string" && typeof path === "string") {
    const destination = moved.get(path);
    if (destination) {
      return { ...node, storeId: SECRET_STORE_ID, path: destination };
    }
  }
  return Object.fromEntries(
    Object.entries(node).map(([k, v]) => [k, rehomeRefs(v, moved)]),
  );
}
