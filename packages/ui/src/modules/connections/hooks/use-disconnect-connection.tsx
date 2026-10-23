import { api } from "../../../api.js";
import { useStore } from "../../../store.js";
import { AffectedAgents } from "../../agents/components/affected-agents.js";
import { useDeleteConnection } from "../api/mutations.js";

async function affectedSandboxNames(connectionId: string): Promise<string[]> {
  try {
    const agents = await api.agents.list.query();
    const names = await Promise.all(
      agents.map(async (a) => {
        const grants = await api.connections.getAgentConnections.query({
          agentId: a.id,
        });
        return grants.connections.some((c) => c.connectionId === connectionId)
          ? a.name
          : null;
      }),
    );
    return names.filter((n): n is string => n !== null);
  } catch {
    return [];
  }
}

export function useDisconnectConnection() {
  const del = useDeleteConnection();
  const showConfirm = useStore((s) => s.showConfirm);

  const confirmAndDelete = async (
    id: string,
    name: string,
  ): Promise<boolean> => {
    const affected = await affectedSandboxNames(id);
    const ok = await showConfirm(
      <>
        <p>
          This connection will be deleted. Any agent using it may no longer
          function as expected.
        </p>
        {affected.length > 0 && <AffectedAgents names={affected} />}
      </>,
      `Delete ${name}?`,
      { kind: "destructive", confirmLabel: "Delete connection" },
    );
    if (ok) del.mutate({ id });
    return ok;
  };

  return {
    confirmAndDelete,
    deletingId: del.isPending ? (del.variables?.id ?? null) : null,
  };
}
