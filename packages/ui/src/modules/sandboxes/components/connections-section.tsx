import { Add } from "@carbon/icons-react";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useSetAgentConnections } from "../../agents/api/mutations.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useSetPreferredConnection } from "../../connections/api/mutations.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../connections/hooks/use-catalog-groups.js";
import { useConfirmSharedConnection } from "../../connections/hooks/use-confirm-shared-connection.js";
import { SatellitesGroup } from "../../satellites/components/satellites-group.js";
import { useAgentSatellites } from "../../satellites/hooks/use-agent-satellites.js";
import { useSharedChannels } from "../hooks/use-shared-channels.js";
import { excludeProviderConnections } from "../lib/provider-connections.js";
import { GrantedConnectionsPanel } from "./granted-connections-panel.js";
import type { SectionHeaderSlot } from "./sandbox-home-header.js";

interface Props {
  agentId: string;
  oauthReturnView: string;
  header: SectionHeaderSlot;
  leading?: ReactNode;
}

export function ConnectionsSection({
  agentId,
  oauthReturnView,
  header,
  leading,
}: Props) {
  const connectionsQ = useAppConnections();
  const agentConnectionsQ = useAgentConnections(agentId);
  const setConnections = useSetAgentConnections();
  const setPreferred = useSetPreferredConnection();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const navigateToSandboxHome = useStore((st) => st.navigateToSandboxHome);
  const satellites = useAgentSatellites(agentId);
  const sharedChannels = useSharedChannels(agentId);
  const shareConfirm = useConfirmSharedConnection(sharedChannels);

  const grantedIds = useMemo(
    () =>
      new Set(
        agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [],
      ),
    [agentConnectionsQ.data],
  );
  const grants = useMemo(
    () =>
      new Map(
        (agentConnectionsQ.data?.connections ?? []).map((c) => [
          c.connectionId,
          { grantedAt: c.grantedAt, preferred: c.preferred },
        ]),
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
    <>
      {header(
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCatalogOpen(true)}
          data-testid="open-connection-catalog"
        >
          <Add size={16} />
          Add connection
        </Button>,
      )}
      {leading}
      <GrantedConnectionsPanel
        groups={groups}
        granted={granted}
        templateById={templateById}
        onToggleGrant={toggleGrant}
        onOpenCatalog={() => setCatalogOpen(true)}
        newInHeader
        grants={grants}
        onPreferConnection={(connectionId) =>
          setPreferred.mutate({ agentId, connectionId })
        }
        preferPending={setPreferred.isPending}
        extraGroups={
          satellites.granted.length > 0 && (
            <SatellitesGroup
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
          sharing={{
            channels: sharedChannels,
            confirm: shareConfirm.confirm,
            dismissed: shareConfirm.dismissed,
          }}
          satelliteGrant={satellites.grantControls}
          oauthReturnView={oauthReturnView}
        />
      )}
    </>
  );
}
