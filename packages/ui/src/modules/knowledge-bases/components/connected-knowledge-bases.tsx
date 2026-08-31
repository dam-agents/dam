import { SHARED_KB_TEMPLATE_ID } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useSetAgentConnections } from "../../agents/api/mutations.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useConnectKnowledgeBase } from "../hooks/use-connect-knowledge-base.js";
import { KbLinkForm } from "./kb-link-form.js";

export function ConnectedKnowledgeBases({ agentId }: { agentId: string }) {
  const connectionsQ = useAppConnections({ fresh: true });
  const agentConnectionsQ = useAgentConnections(agentId);
  const setConnections = useSetAgentConnections();
  const form = useConnectKnowledgeBase();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const ready = agentConnectionsQ.data != null;
  const currentIds = (): string[] =>
    agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [];
  const grantedIds = new Set(currentIds());
  const granted = (connectionsQ.data ?? []).filter(
    (c) => c.templateId === SHARED_KB_TEMPLATE_ID && grantedIds.has(c.id),
  );

  const grant = (id: string) => {
    if (!ready) return;
    setConnections.mutate({
      agentId,
      connectionIds: [...new Set([...currentIds(), id])],
    });
  };
  const ungrant = (id: string) => {
    if (!ready) return;
    setRemovingId(id);
    setConnections.mutate(
      { agentId, connectionIds: currentIds().filter((x) => x !== id) },
      { onSettled: () => setRemovingId(null) },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Paste a knowledge base share link to give this agent read-only access to
        it. Ask a knowledge base owner for their link.
      </p>

      <KbLinkForm
        link={form.link}
        setLink={form.setLink}
        error={form.error}
        formatOk={form.formatOk}
        trimmed={form.trimmed}
        busy={form.busy}
        disabled={!ready}
        onConnect={() => form.connect(grant)}
      />

      {agentConnectionsQ.isError && (
        <p className="text-xs text-warning">
          Couldn't load this agent's connections — reload before changing them.
        </p>
      )}

      {connectionsQ.isError ? (
        <p className="text-xs text-warning">
          Couldn't load the connected knowledge bases — reload to see the
          current list.
        </p>
      ) : connectionsQ.isPending ? (
        <p className="text-xs text-muted-foreground">
          Loading connected knowledge bases…
        </p>
      ) : granted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No knowledge bases connected yet. Paste a share link above and this
          agent can list, search, and read the shared content.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {granted.map((connection) => {
            const unreachable = connection.status === "expired";
            return (
              <div
                key={connection.id}
                className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                  unreachable ? "border-warning/50" : "border-border"
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {connection.name}
                  </span>
                  {unreachable && (
                    <span className="text-xs text-warning">
                      Link rotated or revoked — paste the owner's current link
                      above to reconnect.
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={!ready || removingId === connection.id}
                  onClick={() => ungrant(connection.id)}
                >
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
