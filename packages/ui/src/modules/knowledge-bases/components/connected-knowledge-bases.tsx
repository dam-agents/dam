import { type ConnectionView, SHARED_KB_TEMPLATE_ID } from "api-server-api";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { LIST_ROW, ListSection } from "@/components/ui/list-section";
import { cn } from "@/lib/utils";

import { useSetAgentConnections } from "../../agents/api/mutations.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { KbLinkModal } from "./kb-link-modal.js";

export function ConnectedKnowledgeBases({
  agentId,
  label,
}: {
  agentId: string;
  label?: string;
}) {
  const connectionsQ = useAppConnections({ fresh: true });
  const agentConnectionsQ = useAgentConnections(agentId);
  const setConnections = useSetAgentConnections();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const ready = agentConnectionsQ.data != null;
  const currentIds = (): string[] =>
    agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [];
  const grantedIds = new Set(currentIds());

  return (
    <KnowledgeBaseList
      label={label}
      connections={(connectionsQ.data ?? []).filter((c) =>
        grantedIds.has(c.id),
      )}
      disabled={!ready}
      removingId={removingId}
      onAdd={(id) =>
        setConnections.mutate({
          agentId,
          connectionIds: [...new Set([...currentIds(), id])],
        })
      }
      onRemove={(id) => {
        setRemovingId(id);
        setConnections.mutate(
          { agentId, connectionIds: currentIds().filter((x) => x !== id) },
          { onSettled: () => setRemovingId(null) },
        );
      }}
      loading={connectionsQ.isPending || agentConnectionsQ.isPending}
      error={
        (connectionsQ.isError || agentConnectionsQ.isError) &&
        "Couldn't load the connected knowledge bases."
      }
    />
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The list of knowledge bases an agent reads, with
 * a modal to connect one by share link. The agent configuration page saves
 * each change at once; the agent creation page stages them until create.
 */
export function KnowledgeBaseList({
  label,
  description,
  connections,
  onAdd,
  onRemove,
  removingId,
  disabled,
  loading,
  error,
}: {
  label?: string;
  description?: string;
  connections: ConnectionView[];
  onAdd: (connectionId: string) => void;
  onRemove: (connectionId: string) => void;
  removingId?: string | null;
  disabled?: boolean;
  loading?: boolean;
  error?: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const kbs = connections.filter((c) => c.templateId === SHARED_KB_TEMPLATE_ID);
  return (
    <>
      <ListSection
        label={label}
        description={description}
        onNew={() => setAdding(true)}
        newDisabled={disabled}
        newTestId="kb-connect-new"
        loading={loading}
        error={error}
        isEmpty={kbs.length === 0}
        empty="No knowledge bases connected yet."
      >
        {kbs.map((connection) => {
          const unreachable = connection.status === "expired";
          return (
            <div key={connection.id} className={LIST_ROW}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {connection.name}
                </span>
                {unreachable && (
                  <span className="text-xs text-warning">
                    Link rotated or revoked — connect the owner's current link
                    to restore access.
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                tone="danger"
                className={cn(unreachable && "border-warning/50")}
                disabled={disabled || removingId === connection.id}
                onClick={() => onRemove(connection.id)}
              >
                Remove
              </Button>
            </div>
          );
        })}
      </ListSection>
      {adding && (
        <KbLinkModal onConnected={onAdd} onClose={() => setAdding(false)} />
      )}
    </>
  );
}
