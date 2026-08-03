import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import { api } from "../../../api.js";
import { useStore } from "../../../store.js";
import { useDeleteConnection } from "../api/mutations.js";

// No endpoint lists a connection's grantees, so fan out over the (small)
// agent list; a failed lookup degrades to a dialog without the list.
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

/**
 * Confirm-then-delete a connection. Deleting is global — it removes the
 * connection for every sandbox — so this always confirms first, listing the
 * sandboxes it is granted to. Shared by every surface that offers deletion
 * (the catalogue modal and Settings → Connections). `confirmAndDelete`
 * resolves to whether the user confirmed, so callers can run follow-up work
 * (e.g. drop a staged grant).
 */
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
          This connection will be deleted. Any sandbox using it may no longer
          function as expected.
        </p>
        {affected.length > 0 && (
          <Callout tone="muted" className="mt-4">
            <SectionLabel>Affected sandboxes</SectionLabel>
            <ul className="mt-2 list-disc pl-5 text-sm text-foreground/90">
              {affected.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Callout>
        )}
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
