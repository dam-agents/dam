import { Add } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { useSetAgentConnections } from "../../agents/api/mutations.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { ConnectionGroupCard } from "../../connections/components/connection-group-card.js";
import { useCatalogGroups } from "../../connections/hooks/use-catalog-groups.js";
import { useDisconnectConnection } from "../../connections/hooks/use-disconnect-connection.js";
import { excludeProviderConnections } from "../lib/provider-connections.js";

interface Props {
  agentId: string;
  oauthReturnView: string;
}

/** Grants apply immediately here — only the create wizard stages, since its
 *  sandbox doesn't exist yet. */
export function ConnectionsSection({ agentId, oauthReturnView }: Props) {
  const connectionsQ = useAppConnections();
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

  // Provider credentials are managed by the Provider picker, not here.
  const granted = useMemo(
    () =>
      excludeProviderConnections(connectionsQ.data ?? []).filter((c) =>
        grantedIds.has(c.id),
      ),
    [connectionsQ.data, grantedIds],
  );
  const { populated: groups, templateById } = useCatalogGroups(granted);

  const newButton = (
    <Button
      variant="outline"
      className="h-[32px] px-3 text-[14px] font-normal"
      onClick={() => setCatalogOpen(true)}
      data-testid="open-connection-catalog"
    >
      <Add size={16} />
      New
    </Button>
  );

  return (
    <section>
      {granted.length > 0 ? (
        <>
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>My connections</SectionLabel>
            {newButton}
          </div>
          <Inset className="flex flex-col gap-4">
            {groups.map((group) => (
              <ConnectionGroupCard
                key={group.provider.id}
                group={group}
                templateById={templateById}
                showCount
                grant={(c) => ({
                  granted: true,
                  onToggle: (on) => toggleGrant(c.id, on),
                  actionHidden: true,
                })}
                onDelete={(id, name) => void confirmAndDelete(id, name)}
                deletingId={deletingId}
              />
            ))}
          </Inset>
        </>
      ) : (
        <>
          <SectionLabel spaced>My connections</SectionLabel>
          <Inset className="rounded-lg border border-border bg-card">
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
          </Inset>
        </>
      )}
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
