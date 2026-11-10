import { type ReactNode, useMemo, useState } from "react";

import { SectionHeading } from "@/components/ui/section-heading";

import { useStore } from "../../../store.js";
import { useAgent } from "../../agents/api/queries.js";
import { OwnerOnlyNotice } from "../../agents/components/owner-only-notice.js";
import { ownerName } from "../../agents/lib/agent-permissions.js";
import { useSetPreferredConnection } from "../../connections/api/mutations.js";
import { ConnectionAudienceNotice } from "../../connections/components/connection-audience-notice.js";
import { ConnectionAudienceSentence } from "../../connections/components/connection-audience-sentence.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../connections/hooks/use-catalog-groups.js";
import { SatellitesGroup } from "../../satellites/components/satellites-group.js";
import { useAgentSatellites } from "../../satellites/hooks/use-agent-satellites.js";
import { useAgentConnectionGrants } from "../hooks/use-agent-connection-grants.js";
import { excludeProviderConnections } from "../lib/provider-connections.js";
import { GrantedConnectionsPanel } from "./granted-connections-panel.js";
import type { SectionHeaderSlot } from "./sandbox-home-header.js";

interface Props {
  agentId: string;
  oauthReturnView: string;
  header: SectionHeaderSlot;
  leading?: ReactNode;
  onGoToChannels?: () => void;
  panelHeading?: string;
}

export function ConnectionsSection({
  agentId,
  oauthReturnView,
  header,
  leading,
  onGoToChannels,
  panelHeading,
}: Props) {
  const {
    granted,
    grantedIds,
    grants,
    managesConnections,
    editors,
    audience,
    sharing: shareConfirm,
    toggleGrant,
    revokeGrants,
  } = useAgentConnectionGrants(agentId);
  const access = useAgent(agentId)?.access;
  const setPreferred = useSetPreferredConnection();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const navigateToSandboxHome = useStore((st) => st.navigateToSandboxHome);
  const satellites = useAgentSatellites(agentId);

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
            audience={audience}
            uses="these connections"
          />
        </ConnectionAudienceNotice>
      )}
      {leading}
      {panelHeading && (
        <SectionHeading
          label={panelHeading}
          addLabel="Add connection"
          onAdd={managesConnections ? () => setCatalogOpen(true) : undefined}
        />
      )}
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
        addRowHidden={panelHeading !== undefined}
        flush={panelHeading !== undefined}
        flat={panelHeading !== undefined}
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
            if (onGoToChannels) onGoToChannels();
            else navigateToSandboxHome(agentId, "channels");
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
          singlePage={panelHeading !== undefined}
        />
      )}
    </>
  );
}
