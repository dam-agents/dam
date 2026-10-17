import { Add } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ListSection } from "@/components/ui/list-section";
import { PageHeader } from "@/components/ui/page-header";

import { NO_SATELLITES, useSatellites } from "../../satellites/api/queries.js";
import { SatellitesGroup } from "../../satellites/components/satellites-group.js";
import { useRemoveSatelliteWithConfirm } from "../../satellites/hooks/use-remove-satellite.js";
import { useAppConnections } from "../api/queries.js";
import { ConnectionCatalogModal } from "../components/connection-catalog-modal.js";
import { ConnectionGroup } from "../components/connection-group.js";
import { ConnectionMaintenanceDialog } from "../components/connection-update-credential-dialog.js";
import { useCatalogGroups } from "../hooks/use-catalog-groups.js";
import { useConnectionMaintenance } from "../hooks/use-connection-maintenance.js";
import { useDisconnectConnection } from "../hooks/use-disconnect-connection.js";

export function ConnectionsView() {
  const connectionsQ = useAppConnections({ fresh: true });
  const { data: satellites = NO_SATELLITES } = useSatellites({ live: true });
  const { confirmAndRemove, removingName } = useRemoveSatelliteWithConfirm();
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const maintenance = useConnectionMaintenance();
  const [catalogOpen, setCatalogOpen] = useState(false);

  const { populated: groups, templateById } = useCatalogGroups(
    connectionsQ.data ?? [],
  );

  return (
    <div>
      <PageHeader
        title="Connections"
        description="Give your agents access to services, without handing them the credentials."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCatalogOpen(true)}
            data-testid="open-connection-catalog"
          >
            <Add size={16} />
            New connection
          </Button>
        }
      />

      <ListSection
        loading={connectionsQ.isPending}
        error={connectionsQ.isError && "Couldn't load connections."}
        isEmpty={groups.length === 0 && satellites.length === 0}
        empty="No connections yet. Add one to let your agents reach a service."
      >
        {groups.map((group) => (
          <ConnectionGroup
            key={group.provider.id}
            group={group}
            templateById={templateById}
            onDelete={(id, name) => void confirmAndDelete(id, name)}
            deletingId={deletingId}
            maintenance={maintenance.rowActions}
          />
        ))}
        {satellites.length > 0 && (
          <SatellitesGroup
            satellites={satellites}
            onRemove={(s) => void confirmAndRemove(s)}
            removingName={removingName}
          />
        )}
      </ListSection>

      {catalogOpen && (
        <ConnectionCatalogModal onClose={() => setCatalogOpen(false)} />
      )}

      <ConnectionMaintenanceDialog maintenance={maintenance} />
    </div>
  );
}
