import { useMemo, useState } from "react";

import { useStore } from "../../../store.js";
import { useSetAgentConnections } from "../../agents/api/mutations.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../connections/hooks/use-catalog-groups.js";
import { SatellitesGroupCard } from "../../satellites/components/satellites-group-card.js";
import { useAgentSatellites } from "../../satellites/hooks/use-agent-satellites.js";
import { excludeProviderConnections } from "../lib/provider-connections.js";
import { GrantedConnectionsPanel } from "./granted-connections-panel.js";

interface Props {
  agentId: string;
  oauthReturnView: string;
}

export function ConnectionsSection({ agentId, oauthReturnView }: Props) {
  const connectionsQ = useAppConnections();
  const agentConnectionsQ = useAgentConnections(agentId);
  const setConnections = useSetAgentConnections();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const navigateToSandboxHome = useStore((st) => st.navigateToSandboxHome);
  const satellites = useAgentSatellites(agentId);

  const grantedIds = useMemo(
    () =>
      new Set(
        agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [],
      ),
    [agentConnectionsQ.data],
  );
  const toggleGrant = (id: string, on: boolean) => {
    const current =
      agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [];
    const next = on
      ? [...new Set([...current, id])]
      : current.filter((x) => x !== id);
    setConnections.mutate({ agentId, connectionIds: next });
  };

  const granted = useMemo(
    () => (connectionsQ.data ?? []).filter((c) => grantedIds.has(c.id)),
    [connectionsQ.data, grantedIds],
  );
  const listed = useMemo(() => excludeProviderConnections(granted), [granted]);
  const { populated: groups, templateById } = useCatalogGroups(listed);

  return (
    <section>
      <GrantedConnectionsPanel
        groups={groups}
        granted={granted}
        templateById={templateById}
        onToggleGrant={toggleGrant}
        onOpenCatalog={() => setCatalogOpen(true)}
        leading={
          satellites.granted.length > 0 && (
            <SatellitesGroupCard
              satellites={satellites.granted}
              showCount
              grant={(s) => ({
                ...satellites.grantControls(s),
                actionHidden: true,
              })}
            />
          )
        }
      />
      {catalogOpen && (
        <ConnectionCatalogModal
          onGoToChannels={() => {
            setCatalogOpen(false);
            navigateToSandboxHome(agentId, "channels");
          }}
          onClose={() => setCatalogOpen(false)}
          sandbox={{ grantedIds, onToggleGrant: toggleGrant }}
          satelliteGrant={satellites.grantControls}
          oauthReturnView={oauthReturnView}
        />
      )}
    </section>
  );
}
