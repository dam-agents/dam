import { Add } from "@carbon/icons-react";
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { useState } from "react";

import { AddRow, ListSection } from "@/components/ui/list-section";

import { ConnectionGroup } from "../../connections/components/connection-group.js";
import { ConnectionMaintenanceDialog } from "../../connections/components/connection-update-credential-dialog.js";
import {
  DefaultAccountsCallout,
  type GrantDetails,
} from "../../connections/components/default-accounts-callout.js";
import { GrantRivalryCallout } from "../../connections/components/grant-rivalry-callout.js";
import { GrantScopeDialog } from "../../connections/components/grant-scope-dialog.js";
import {
  type GrantAgent,
  GrantToolAccessDialog,
} from "../../connections/components/grant-tool-access-dialog.js";
import { useConnectionMaintenance } from "../../connections/hooks/use-connection-maintenance.js";
import { useGrantRowScope } from "../../connections/hooks/use-grant-row-scope.js";
import { useGrantRowToolAccess } from "../../connections/hooks/use-grant-row-tool-access.js";
import type { CatalogProviderGroup } from "../../connections/lib/catalog-providers.js";

interface Props {
  groups: CatalogProviderGroup[];
  granted: readonly ConnectionView[];
  templateById: Map<string, ConnectionTemplateView>;
  onToggleGrant: (id: string, on: boolean) => void;
  onOpenCatalog: () => void;
  grants?: ReadonlyMap<string, GrantDetails>;
  onPreferConnection?: (connectionId: string) => void;
  preferPending?: boolean;
  title?: string;
  leading?: React.ReactNode;
  extraGroups?: React.ReactNode;
  addRowHidden?: boolean;
  readOnly?: boolean;
  flush?: boolean;
  flat?: boolean;
  toolAccessFor?: GrantAgent;
}

export function GrantedConnectionsPanel({
  groups,
  granted,
  templateById,
  onToggleGrant,
  onOpenCatalog,
  grants,
  onPreferConnection,
  preferPending,
  title,
  leading,
  extraGroups,
  addRowHidden = false,
  readOnly = false,
  flush = false,
  flat = false,
  toolAccessFor,
}: Props) {
  const maintenance = useConnectionMaintenance();
  const [editingAccess, setEditingAccess] = useState<ConnectionView | null>(
    null,
  );
  const [editingScope, setEditingScope] = useState<ConnectionView | null>(null);
  const toolAccess = useGrantRowToolAccess(
    grants,
    toolAccessFor && setEditingAccess,
  );
  const scope = useGrantRowScope(grants, toolAccessFor && setEditingScope);
  const rowAccess =
    toolAccess || scope
      ? (c: ConnectionView) => scope?.(c) ?? toolAccess?.(c)
      : undefined;
  const editedAccess =
    editingAccess && grants?.get(editingAccess.id)?.toolAccess;

  return (
    <>
      <GrantRivalryCallout granted={granted} className="mb-3" />
      {grants && onPreferConnection && !readOnly && (
        <DefaultAccountsCallout
          granted={granted}
          grants={grants}
          onPrefer={onPreferConnection}
          pending={preferPending}
          className="mb-3"
        />
      )}
      {leading && <div className="mb-4">{leading}</div>}
      <ListSection
        className={flush ? "mb-0" : undefined}
        label={title}
        isEmpty={groups.length === 0 && !extraGroups}
        empty="No connections added to this agent yet."
        onNew={readOnly ? undefined : onOpenCatalog}
        newLabel="Add connection"
        newTestId="open-connection-catalog"
        addRow={
          !readOnly &&
          !addRowHidden && (
            <AddRow onClick={onOpenCatalog} testId="open-connection-catalog">
              <Add size={16} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-md font-medium text-foreground">
                  Add connection
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  Add a service this agent can reach.
                </p>
              </div>
            </AddRow>
          )
        }
      >
        {extraGroups}
        {groups.map((group) => (
          <ConnectionGroup
            key={group.provider.id}
            group={group}
            templateById={templateById}
            showCount={!flat}
            flat={flat}
            grant={
              readOnly
                ? undefined
                : (c) => ({
                    granted: true,
                    onToggle: (on) => onToggleGrant(c.id, on),
                    actionHidden: true,
                  })
            }
            onManage={readOnly ? undefined : onOpenCatalog}
            maintenance={readOnly ? undefined : maintenance.rowActions}
            toolAccess={rowAccess}
          />
        ))}
      </ListSection>
      <ConnectionMaintenanceDialog maintenance={maintenance} />
      {toolAccessFor && editingAccess && editedAccess && (
        <GrantToolAccessDialog
          agent={toolAccessFor}
          connection={editingAccess}
          access={editedAccess}
          onClose={() => setEditingAccess(null)}
        />
      )}
      {toolAccessFor && editingScope && (
        <GrantScopeDialog
          agent={toolAccessFor}
          connection={editingScope}
          actsAsItself={grants?.get(editingScope.id)?.scope !== undefined}
          onClose={() => setEditingScope(null)}
        />
      )}
    </>
  );
}
