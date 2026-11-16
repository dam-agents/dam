import { Add } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { AddRow, ListSection } from "@/components/ui/list-section";
import { PageHeader } from "@/components/ui/page-header";
import { emitToast } from "@/lib/toast";

import { NO_SATELLITES, useSatellites } from "../../satellites/api/queries.js";
import { SatellitesGroup } from "../../satellites/components/satellites-group.js";
import { useRemoveSatelliteWithConfirm } from "../../satellites/hooks/use-remove-satellite.js";
import { useAppConnections } from "../api/queries.js";
import { CatalogProviderCard } from "../components/catalog-provider-card.js";
import { ConnectionCatalogModal } from "../components/connection-catalog-modal.js";
import { ConnectionCreateChildDialog } from "../components/connection-create-child-dialog.js";
import { ConnectionMaintenanceDialog } from "../components/connection-update-credential-dialog.js";
import { useCatalogGroups } from "../hooks/use-catalog-groups.js";
import { useConnectionHolders } from "../hooks/use-connection-holders.js";
import { useConnectionMaintenance } from "../hooks/use-connection-maintenance.js";
import { useDisconnectConnection } from "../hooks/use-disconnect-connection.js";

export function ConnectionsView() {
  const connectionsQ = useAppConnections({ fresh: true });
  const { data: satellites = NO_SATELLITES } = useSatellites({ live: true });
  const { confirmAndRemove, removingName } = useRemoveSatelliteWithConfirm();
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const maintenance = useConnectionMaintenance();
  const [catalog, setCatalog] = useState<{ providerId?: string } | null>(null);
  const holders = useConnectionHolders();
  const [childOf, setChildOf] = useState<ConnectionView | null>(null);

  const { populated: groups, templateById } = useCatalogGroups(
    connectionsQ.data ?? [],
  );

  const addRow = (
    <AddRow onClick={() => setCatalog({})} testId="open-connection-catalog">
      <Add size={16} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-md font-medium text-foreground">
          Add connection
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          Add a service your agents can reach.
        </p>
      </div>
    </AddRow>
  );

  return (
    <div>
      <PageHeader
        title="Connections"
        description="Give your agents access to services, without handing them the credentials."
      />

      {groups.length === 0 || connectionsQ.isPending ? (
        <ListSection
          loading={connectionsQ.isPending}
          error={connectionsQ.isError && "Couldn't load connections."}
          isEmpty={satellites.length === 0}
          empty="No connections yet. Add one to let your agents reach a service."
          onNew={() => setCatalog({})}
          newLabel="Add connection"
          newTestId="open-connection-catalog"
          addRow={addRow}
        >
          <SatellitesGroup
            satellites={satellites}
            onRemove={(s) => void confirmAndRemove(s)}
            removingName={removingName}
          />
        </ListSection>
      ) : (
        <div className="mb-8 flex flex-col gap-8">
          {groups.map((group) => (
            <CatalogProviderCard
              key={group.provider.id}
              group={group}
              templateById={templateById}
              onNew={() => setCatalog({ providerId: group.provider.id })}
              onDelete={(id, name) => void confirmAndDelete(id, name)}
              deletingId={deletingId}
              maintenance={maintenance.rowActions}
              onNewChild={setChildOf}
              holders={holders}
            />
          ))}
          {satellites.length > 0 && (
            <Card className="overflow-hidden">
              <SatellitesGroup
                satellites={satellites}
                onRemove={(s) => void confirmAndRemove(s)}
                removingName={removingName}
              />
            </Card>
          )}
          <Card className="overflow-hidden">{addRow}</Card>
        </div>
      )}

      {catalog && (
        <ConnectionCatalogModal
          initialProviderId={catalog.providerId}
          onClose={() => setCatalog(null)}
        />
      )}

      <ConnectionMaintenanceDialog maintenance={maintenance} />

      {childOf && (
        <ConnectionCreateChildDialog
          parent={childOf}
          onClose={() => setChildOf(null)}
          onCreated={() => {
            setChildOf(null);
            emitToast({ kind: "success", message: "Connection created." });
          }}
        />
      )}
    </div>
  );
}
