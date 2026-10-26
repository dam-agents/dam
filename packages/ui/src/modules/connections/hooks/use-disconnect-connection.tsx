import type { ConnectionView } from "api-server-api";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import { useDeleteConnection } from "../api/mutations.js";
import { ConnectionDeleteImpact } from "../components/connection-delete-impact.js";
import { ParentDeleteImpact } from "../components/parent-delete-impact.js";
import { childrenOf, parentNoun } from "../lib/connection-hierarchy.js";

async function agentsHolding(
  connectionIds: readonly string[],
): Promise<Map<string, string[]> | null> {
  const holders = new Map(connectionIds.map((id) => [id, [] as string[]]));
  try {
    const agents = await api.agents.list.query();
    const grants = await Promise.all(
      agents.map(async (a) => ({
        name: a.name,
        granted: await api.connections.getAgentConnections.query({
          agentId: a.id,
        }),
      })),
    );
    for (const { name, granted } of grants)
      for (const { connectionId } of granted.connections)
        holders.get(connectionId)?.push(name);
  } catch {
    return null;
  }
  return holders;
}

function listedConnection(id: string): {
  connection: ConnectionView | undefined;
  children: ConnectionView[];
} {
  const connections =
    queryClient.getQueryData<ConnectionView[]>(
      trpc.connections.list.queryKey(),
    ) ?? [];
  return {
    connection: connections.find((c) => c.id === id),
    children: childrenOf(id, connections),
  };
}

export function useDisconnectConnection() {
  const del = useDeleteConnection();
  const showConfirm = useStore((s) => s.showConfirm);

  const confirmParent = async (
    parent: ConnectionView,
    children: readonly ConnectionView[],
  ) => {
    const holders = await agentsHolding(children.map((c) => c.id));
    const noun = parentNoun(parent);
    return showConfirm(
      <ParentDeleteImpact
        noun={noun}
        childConnections={children.map((c) => ({
          name: c.name,
          agents: holders ? (holders.get(c.id) ?? []) : null,
        }))}
      />,
      `Delete the ${noun} ${parent.name}?`,
      { kind: "destructive", confirmLabel: `Delete ${noun}` },
    );
  };

  const confirmConnection = async (id: string, name: string) => {
    const holders = await agentsHolding([id]);
    return showConfirm(
      <ConnectionDeleteImpact
        agents={holders ? (holders.get(id) ?? []) : null}
      />,
      `Delete ${name}?`,
      { kind: "destructive", confirmLabel: "Delete connection" },
    );
  };

  const confirmAndDelete = async (
    id: string,
    name: string,
  ): Promise<boolean> => {
    const { connection, children } = listedConnection(id);
    const ok = connection?.isParent
      ? await confirmParent(connection, children)
      : await confirmConnection(id, name);
    if (ok) del.mutate({ id });
    return ok;
  };

  return {
    confirmAndDelete,
    deletingId: del.isPending ? (del.variables?.id ?? null) : null,
  };
}
