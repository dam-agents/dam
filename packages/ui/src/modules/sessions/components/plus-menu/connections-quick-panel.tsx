import { Add } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";

import type { RowMaintenanceActions } from "../../../connections/components/catalog-connection-row.js";
import { ConnectionGroup } from "../../../connections/components/connection-group.js";
import { useCatalogGroups } from "../../../connections/hooks/use-catalog-groups.js";
import { useAgentConnectionGrants } from "../../../sandboxes/hooks/use-agent-connection-grants.js";
import { excludeProviderConnections } from "../../../sandboxes/lib/provider-connections.js";
import { PlusMenuNote, PlusMenuPanelFrame } from "./plus-menu-panel.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Connections panel of the composer's + menu,
 * as the design draws it: the Connections the Agent holds, other than model
 * providers, in one card per service with its count, each row with its ⋯ menu
 * (re-authenticate, update the credential, remove it from the Agent), and Add
 * connection, which opens the catalog to grant more. The menu's dialogs are the
 * + menu's to draw, after it closes. A viewer who may not
 * change the Agent's Connections sees the cards with no menu.
 */
export function ConnectionsQuickPanel({
  agentId,
  onBack,
  onManage,
  onAdd,
  rowActions,
}: {
  agentId: string;
  onBack: () => void;
  onManage?: () => void;
  onAdd: () => void;
  rowActions: (connection: ConnectionView) => RowMaintenanceActions | undefined;
}) {
  const grants = useAgentConnectionGrants(agentId);
  const listed = useMemo(
    () => excludeProviderConnections(grants.granted),
    [grants.granted],
  );
  const { populated: groups, templateById } = useCatalogGroups(listed);
  const manages = grants.managesConnections;
  /* UNIT_BOUNDARY_DESCRIPTION: nothing is listed before the Agent's grants load: a list drawn on a pending read would show the Agent holding none. */
  const ready = grants.loaded && !grants.failed;

  return (
    <PlusMenuPanelFrame
      title="Connections"
      onBack={onBack}
      onManage={onManage}
      footer={
        manages && (
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Add size={16} /> Add connection
          </Button>
        )
      }
    >
      {!grants.loaded && <PlusMenuNote>Loading connections…</PlusMenuNote>}
      {grants.failed && <PlusMenuNote>Couldn't load connections.</PlusMenuNote>}
      {ready && groups.length === 0 && (
        <PlusMenuNote>No connections configured.</PlusMenuNote>
      )}
      {ready && groups.length > 0 && (
        <div className="flex flex-col gap-3 py-2">
          {groups.map((group) => (
            <ConnectionGroup
              key={group.provider.id}
              group={group}
              templateById={templateById}
              showCount
              grant={
                manages
                  ? (c) => ({
                      granted: true,
                      onToggle: (on) => grants.toggleGrant(c.id, on),
                      actionHidden: true,
                    })
                  : undefined
              }
              maintenance={manages ? rowActions : undefined}
            />
          ))}
        </div>
      )}
    </PlusMenuPanelFrame>
  );
}
