import { Add } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { useSetAgentConnections } from "../../agents/api/mutations.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import { CatalogConnectionRow } from "../../connections/components/catalog-connection-row.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { useDisconnectConnection } from "../../connections/hooks/use-disconnect-connection.js";
import { connectionKindSubtitle } from "../../connections/lib/catalog-providers.js";
import { excludeProviderConnections } from "../lib/provider-connections.js";

interface Props {
  agentId: string;
  oauthReturnView: string;
}

/** Grants apply immediately here — only the create wizard stages, since its
 *  sandbox doesn't exist yet. */
export function ConnectionsSection({ agentId, oauthReturnView }: Props) {
  const connectionsQ = useAppConnections();
  const templatesQ = useConnectionTemplates();
  const agentConnectionsQ = useAgentConnections(agentId);
  const setConnections = useSetAgentConnections();
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const [catalogOpen, setCatalogOpen] = useState(false);

  const grantedIds = useMemo(
    () =>
      new Set(
        agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [],
      ),
    [agentConnectionsQ.data],
  );
  // setAgentConnections replaces the full set, so resend untouched grants.
  const toggleGrant = (id: string, on: boolean) => {
    const current =
      agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [];
    const next = on
      ? [...new Set([...current, id])]
      : current.filter((x) => x !== id);
    setConnections.mutate({ agentId, connectionIds: next });
  };

  const templateById = useMemo(
    () => new Map((templatesQ.data ?? []).map((t) => [t.id, t])),
    [templatesQ.data],
  );
  // Provider credentials are managed by the Provider picker, not here.
  const granted = useMemo(
    () =>
      excludeProviderConnections(connectionsQ.data ?? []).filter((c) =>
        grantedIds.has(c.id),
      ),
    [connectionsQ.data, grantedIds],
  );

  return (
    <section>
      <SectionLabel spaced>Connections</SectionLabel>
      <Inset className="rounded-lg border border-border bg-card">
        {granted.length > 0 ? (
          <>
            <div className="divide-y divide-border">
              {granted.map((c) => (
                <CatalogConnectionRow
                  key={c.id}
                  connection={c}
                  subtitle={connectionKindSubtitle(
                    c,
                    templateById.get(c.templateId),
                  )}
                  grant={{
                    granted: true,
                    onToggle: (on) => toggleGrant(c.id, on),
                    actionHidden: true,
                  }}
                  onDelete={() => void confirmAndDelete(c.id, c.name)}
                  deleting={deletingId === c.id}
                />
              ))}
            </div>
            <div className="border-t border-border px-4 py-3">
              <Button
                variant="outline"
                className="h-[40px] text-[14px]"
                onClick={() => setCatalogOpen(true)}
                data-testid="open-connection-catalog"
              >
                <Add size={16} />
                Add Connection
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 py-10">
            <p className="text-[14px] text-foreground/80">
              You have not added any Connections to this Sandbox yet
            </p>
            <Button
              variant="outline"
              className="h-[40px] text-[14px]"
              onClick={() => setCatalogOpen(true)}
              data-testid="open-connection-catalog"
            >
              <Add size={16} />
              Add Connection
            </Button>
          </div>
        )}
      </Inset>
      {catalogOpen && (
        <ConnectionCatalogModal
          onClose={() => setCatalogOpen(false)}
          sandbox={{ grantedIds, onToggleGrant: toggleGrant }}
          oauthReturnView={oauthReturnView}
        />
      )}
    </section>
  );
}
