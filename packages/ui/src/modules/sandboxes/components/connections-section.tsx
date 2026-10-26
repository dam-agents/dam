import { type ReactNode, useMemo, useState } from "react";

import { useStore } from "../../../store.js";
import { useSetAgentConnections } from "../../agents/api/mutations.js";
import { useAgent, useAgentConnections } from "../../agents/api/queries.js";
import { OwnerOnlyNotice } from "../../agents/components/owner-only-notice.js";
import { holds, ownerName } from "../../agents/lib/agent-permissions.js";
import { useSetPreferredConnection } from "../../connections/api/mutations.js";
import { useAgentPageConnections } from "../../connections/api/queries.js";
import { ConnectionAudienceNotice } from "../../connections/components/connection-audience-notice.js";
import { ConnectionAudienceSentence } from "../../connections/components/connection-audience-sentence.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../connections/hooks/use-catalog-groups.js";
import { useConfirmSharedConnection } from "../../connections/hooks/use-confirm-shared-connection.js";
import { SatellitesGroup } from "../../satellites/components/satellites-group.js";
import { useAgentSatellites } from "../../satellites/hooks/use-agent-satellites.js";
import { useSharedChannels } from "../hooks/use-shared-channels.js";
import { excludeProviderConnections } from "../lib/provider-connections.js";
import { GrantedConnectionsPanel } from "./granted-connections-panel.js";
import type { SectionHeaderSlot } from "./sandbox-home-header.js";

const NO_EDITORS: readonly string[] = [];

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
  const connectionsQ = useAgentPageConnections(agentId);
  const access = useAgent(agentId)?.access;
  const managesConnections = !access || holds(access, "connections");
  const agentConnectionsQ = useAgentConnections(agentId);
  const setConnections = useSetAgentConnections();
  const setPreferred = useSetPreferredConnection();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const navigateToSandboxHome = useStore((st) => st.navigateToSandboxHome);
  const satellites = useAgentSatellites(agentId);
  const sharedChannels = useSharedChannels(agentId);
  const editors = access?.role === "owner" ? access.editors : NO_EDITORS;
  const audience = useMemo(
    () => ({ editors, channels: sharedChannels }),
    [editors, sharedChannels],
  );
  const shareConfirm = useConfirmSharedConnection(audience);

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
  const grantedNow = () =>
    agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [];
  const revokeGrants = (ids: readonly string[]) =>
    setConnections.mutate({
      agentId,
      connectionIds: grantedNow().filter((x) => !ids.includes(x)),
    });
  const toggleGrant = (id: string, on: boolean) => {
    if (on)
      setConnections.mutate({
        agentId,
        connectionIds: [...new Set([...grantedNow(), id])],
      });
    else revokeGrants([id]);
  };

  const granted = useMemo(
    () => (connectionsQ.data ?? []).filter((c) => grantedIds.has(c.id)),
    [connectionsQ.data, grantedIds],
  );
  const listed = useMemo(() => excludeProviderConnections(granted), [granted]);
  const { populated: groups, templateById } = useCatalogGroups(listed);

  return (
    <>
      {header()}
      {access && !managesConnections && (
        <OwnerOnlyNotice
          title="Only the owner changes connections."
          testId="connections-owner-only"
          className="mb-6"
        >
          This agent acts as {ownerName(access)} through them. Ask them to add
          one, remove one, or re-authenticate an expired one.
        </OwnerOnlyNotice>
      )}
      {editors.length > 0 && (
        <ConnectionAudienceNotice
          className="mb-6"
          testId="connections-editors-notice"
        >
          <ConnectionAudienceSentence
            audience={{ editors, channels: sharedChannels }}
            uses="these connections"
          />
        </ConnectionAudienceNotice>
      )}
      {leading}
      <GrantedConnectionsPanel
        readOnly={!managesConnections}
        groups={groups}
        granted={granted}
        templateById={templateById}
        onToggleGrant={toggleGrant}
        onOpenCatalog={() => setCatalogOpen(true)}
        grants={grants}
        onPreferConnection={(connectionId) =>
          setPreferred.mutate({ agentId, connectionId })
        }
        preferPending={setPreferred.isPending}
        extraGroups={
          managesConnections &&
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
      {catalogOpen && managesConnections && (
        <ConnectionCatalogModal
          onGoToChannels={() => {
            setCatalogOpen(false);
            navigateToSandboxHome(agentId, "automations");
          }}
          onClose={() => setCatalogOpen(false)}
          sandbox={{
            grantedIds,
            onToggleGrant: toggleGrant,
            onRevoke: revokeGrants,
          }}
          sharing={shareConfirm}
          satelliteGrant={satellites.grantControls}
          oauthReturnView={oauthReturnView}
        />
      )}
    </>
  );
}
