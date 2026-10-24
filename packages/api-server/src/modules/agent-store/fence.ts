import type * as k8s from "@kubernetes/client-node";
import { isNotFound } from "../agents/infrastructure/k8s.js";

export type AgentStoreMode = "crd" | "postgres";

export const AGENT_STORE_MARKER_KEY = "store";
export const AGENT_STORE_ABSORBED_KEY = "absorbed-at";

export const agentStoreMarkerName = (releaseName: string): string =>
  `${releaseName}-agent-store`;

export const AGENT_STORE_BUILD_READS_POSTGRES = true;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Says whether this build may serve, given the store
 * it is configured for and what the switch has left in the cluster.
 *
 * Three wrong pairings crash-loop instead of corrupting data. An old build whose
 * authority has switched reads custom resources nothing writes any more, and
 * would re-render machines from a frozen view. A build configured for Postgres
 * without an absorb would serve an empty store, and its sweeps would treat
 * every running Agent as deleted. And a build that cannot read Postgres at all
 * refuses the mode however it is configured: configuration says what the
 * operator wants, not what the binary can do, so a rollback that restores
 * images while the chart keeps the switch's values must be refused by the
 * image.
 *
 * The marker is the wake the absorb leaves behind, so both sides read the same
 * fact without the old build needing database access it never had. Absent is
 * the ordinary state, not a fault.
 */
export function agentStoreRefusal(
  mode: AgentStoreMode,
  marker: Record<string, string> | null,
  options: { readsPostgres?: boolean } = {},
): string | null {
  const marked = marker?.[AGENT_STORE_MARKER_KEY] ?? "";
  const switched = marked === "postgres";

  if (mode === "crd") {
    if (switched)
      return "the Agent store has switched to Postgres: this build reconciles the custom resources, which nothing writes any more. Deploy the release that reads Postgres.";
    if (marked !== "" && marked !== "crd")
      return `the Agent store's marker names "${marked}", which this build does not know: it understands "crd" and "postgres" only, and a store it cannot read is one it must not serve.`;
    return null;
  }

  if (!(options.readsPostgres ?? AGENT_STORE_BUILD_READS_POSTGRES))
    return "this build reconciles the custom resources and carries no Postgres reader, so it refuses the Agent store's Postgres mode whatever the cluster's marker says. Deploy the release that reads Postgres.";

  if (!switched)
    return "the Agent store is configured as Postgres but the custom resources have not been absorbed into it, so there is nothing to reconcile. Deploy the release that absorbs them first.";
  if (!marker?.[AGENT_STORE_ABSORBED_KEY])
    return "the Agent store is configured as Postgres but the absorb did not complete: the store's absorbed-at stamp is missing from its marker.";
  return null;
}

const isAlreadyExists = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause as { code: unknown }).code === 409;

export async function writeAgentStoreMarker(
  api: k8s.CoreV1Api,
  namespace: string,
  name: string,
  data: Record<string, string>,
): Promise<void> {
  const body = { metadata: { name }, data };
  try {
    await api.createNamespacedConfigMap({ namespace, body });
  } catch (cause) {
    if (!isAlreadyExists(cause)) throw cause;
    await api.replaceNamespacedConfigMap({ name, namespace, body });
  }
}

export async function readAgentStoreMarker(
  api: k8s.CoreV1Api,
  namespace: string,
  name: string,
): Promise<Record<string, string> | null> {
  try {
    const marker = await api.readNamespacedConfigMap({ namespace, name });
    return (marker.data ?? {}) as Record<string, string>;
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw new Error(
      `cannot read the Agent store marker ConfigMap ${namespace}/${name}: ${
        cause instanceof Error ? cause.message : String(cause)
      }. The marker decides whether this build may serve, so a fence that cannot read it has not passed. Its Role must allow getting this ConfigMap in the agent namespace.`,
    );
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: proves the switch's write fence instead of assuming
 * it: once the rows own the Agents, the api-server's own identity must no longer
 * be able to create, patch or delete an Agent or a budget.
 *
 * It asks the API server what this pod may do, so a chart that kept the old
 * Role stops the switch rather than leaving two writers. A read stays allowed:
 * the absorb reads the resources once, and nothing writes them again.
 */
export async function verifyAgentStoreWriteFence(
  client: k8s.AuthorizationV1Api,
  namespace: string,
): Promise<string | null> {
  const checks = [
    { resource: "agents", verb: "create" },
    { resource: "agents", verb: "patch" },
    { resource: "agents", verb: "delete" },
    { resource: "userbudgets", verb: "create" },
    { resource: "userbudgets", verb: "patch" },
    { resource: "userbudgets", verb: "delete" },
  ];
  for (const check of checks) {
    const review = await client.createSelfSubjectAccessReview({
      body: {
        spec: {
          resourceAttributes: {
            namespace,
            verb: check.verb,
            group: "agent-platform.ai",
            resource: check.resource,
          },
        },
      },
    });
    if (review.status?.allowed === true)
      return `this api-server's ServiceAccount can still ${check.verb} ${check.resource} in ${namespace}: the rows own Agents and budgets, so the switch release must not keep the custom resources' write grants. Narrow the Role before the cutover.`;
  }
  return null;
}
