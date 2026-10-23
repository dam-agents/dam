import type * as k8s from "@kubernetes/client-node";

export type AgentStoreMode = "crd" | "postgres";

export const AGENT_STORE_MARKER_KEY = "store";
export const AGENT_STORE_ABSORBED_KEY = "absorbed-at";

export const agentStoreMarkerName = (releaseName: string): string =>
  `${releaseName}-agent-store`;

export const AGENT_STORE_BUILD_READS_POSTGRES = false;

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
  const switched = marker?.[AGENT_STORE_MARKER_KEY] === "postgres";

  if (mode === "crd") {
    if (switched)
      return "the Agent store has switched to Postgres: this build reconciles the custom resources, which nothing writes any more. Deploy the release that reads Postgres.";
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

export async function readAgentStoreMarker(
  api: k8s.CoreV1Api,
  namespace: string,
  releaseName: string,
): Promise<Record<string, string> | null> {
  try {
    const marker = await api.readNamespacedConfigMap({
      namespace,
      name: agentStoreMarkerName(releaseName),
    });
    return (marker.data ?? {}) as Record<string, string>;
  } catch (cause) {
    const code = (cause as { code?: number } | null)?.code;
    if (code === 404) return null;
    const name = agentStoreMarkerName(releaseName);
    throw new Error(
      `cannot read the Agent store marker ConfigMap ${namespace}/${name}: ${
        cause instanceof Error ? cause.message : String(cause)
      }. The marker decides whether this build may serve, so a fence that cannot read it has not passed. Its Role must allow configmaps get in the agent namespace.`,
    );
  }
}
