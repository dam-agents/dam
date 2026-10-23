import type * as k8s from "@kubernetes/client-node";

export type AgentStoreMode = "crd" | "postgres";

export const AGENT_STORE_MARKER_KEY = "store";
export const AGENT_STORE_ABSORBED_KEY = "absorbed-at";

export const agentStoreMarkerName = (releaseName: string): string =>
  `${releaseName}-agent-store`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Says whether this build may serve, given the store
 * it is configured for and what the switch has left in the cluster.
 *
 * Two wrong pairings crash-loop instead of corrupting data. An old build whose
 * authority has switched reads custom resources nothing writes any more, and
 * would re-render machines from a frozen view. A build configured for Postgres
 * without an absorb would serve an empty store, and its sweeps would treat
 * every running Agent as deleted.
 *
 * The marker is the wake the absorb leaves behind, so both sides read the same
 * fact without the old build needing database access it never had. Absent is
 * the ordinary state, not a fault.
 */
export function agentStoreRefusal(
  mode: AgentStoreMode,
  marker: Record<string, string> | null,
): string | null {
  const switched = marker?.[AGENT_STORE_MARKER_KEY] === "postgres";

  if (mode === "crd") {
    if (switched)
      return "the Agent store has switched to Postgres: this build reconciles the custom resources, which nothing writes any more. Deploy the release that reads Postgres.";
    return null;
  }

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
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause as { code: number }).code === 404
    )
      return null;
    throw cause;
  }
}
