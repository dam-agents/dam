import { Add } from "@carbon/icons-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";

import { useCatalogGroups } from "../../../connections/hooks/use-catalog-groups.js";
import { useAgentConnectionGrants } from "../../../sandboxes/hooks/use-agent-connection-grants.js";
import { excludeProviderConnections } from "../../../sandboxes/lib/provider-connections.js";
import {
  PlusMenuGroup,
  PlusMenuNote,
  PlusMenuPanelFrame,
} from "./plus-menu-panel.js";
import { QuickConnectionRow } from "./quick-connection-row.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Connections panel of the composer's + menu:
 * the owner's Connections other than model providers, by service, each with
 * the switch that adds it to the Agent or removes it, and Add connection,
 * which opens the catalog. A viewer who may not change the Agent's
 * Connections sees the ones it holds, with no switch.
 */
export function ConnectionsQuickPanel({
  agentId,
  onBack,
  onManage,
  onAdd,
}: {
  agentId: string;
  onBack: () => void;
  onManage?: () => void;
  onAdd: () => void;
}) {
  const grants = useAgentConnectionGrants(agentId);
  const listed = useMemo(
    () => excludeProviderConnections(grants.connections),
    [grants.connections],
  );
  const { populated: groups } = useCatalogGroups(listed);

  return (
    <PlusMenuPanelFrame
      title="Connections"
      onBack={onBack}
      onManage={onManage}
      footer={
        grants.managesConnections && (
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Add size={16} /> Add connection
          </Button>
        )
      }
    >
      {!grants.loaded && <PlusMenuNote>Loading connections…</PlusMenuNote>}
      {grants.failed && <PlusMenuNote>Couldn't load connections.</PlusMenuNote>}
      {grants.loaded && !grants.failed && groups.length === 0 && (
        <PlusMenuNote>No connections configured.</PlusMenuNote>
      )}
      {groups.map((group) => (
        <PlusMenuGroup key={group.provider.id} label={group.provider.title}>
          {group.connections.map((connection) => (
            <QuickConnectionRow
              key={connection.id}
              connection={connection}
              grants={grants}
            />
          ))}
        </PlusMenuGroup>
      ))}
    </PlusMenuPanelFrame>
  );
}
