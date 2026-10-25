import { useAgents } from "../api/queries.js";
import { rootDriverOf } from "../lib/root-driver.js";

export function useRootDriver(
  agentId: string | null,
): { id: string; name: string } | null | undefined {
  const { data, isPending } = useAgents();
  if (agentId === null) return null;
  if (isPending) return undefined;
  return rootDriverOf(agentId, [
    ...(data?.list ?? []),
    ...(data?.shared ?? []),
  ]);
}
