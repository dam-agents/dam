import { Add } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { Inset } from "@/components/ui/inset";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useAppConnections } from "../api/queries.js";
import { ConnectionCatalogModal } from "../components/connection-catalog-modal.js";
import { ConnectionGroupCard } from "../components/connection-group-card.js";
import { ConnectionUpdateCredentialDialog } from "../components/connection-update-credential-dialog.js";
import { useCatalogGroups } from "../hooks/use-catalog-groups.js";
import { useConnectionMaintenance } from "../hooks/use-connection-maintenance.js";
import { useDisconnectConnection } from "../hooks/use-disconnect-connection.js";

export function ConnectionsView() {
  const connectionsQ = useAppConnections();
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const maintenance = useConnectionMaintenance();
  const [catalogOpen, setCatalogOpen] = useState(false);

  const { populated: groups, templateById } = useCatalogGroups(
    connectionsQ.data ?? [],
  );

  const newButton = (
    <Button
      variant="outline"
      className="h-8 px-3 text-sm font-normal"
      onClick={() => setCatalogOpen(true)}
      data-testid="open-connection-catalog"
    >
      <Add size={16} />
      New
    </Button>
  );

  return (
    <div className="w-full max-w-2xl">
      <PageHeader
        title="Connections"
        description="Connections are the services and credentials your agents can reach."
      />

      {connectionsQ.isPending ? (
        <ListSkeleton />
      ) : groups.length > 0 ? (
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
                onDelete={(id, name) => void confirmAndDelete(id, name)}
                deletingId={deletingId}
                maintenance={maintenance.rowActions}
              />
            ))}
          </Inset>
        </>
      ) : (
        <>
          <SectionLabel spaced>My connections</SectionLabel>
          <Inset className={CARD_SURFACE}>
            <div className="flex flex-col items-center gap-4 py-10">
              <p className="text-sm text-foreground/80">
                No connections set up yet.
              </p>
              {newButton}
            </div>
          </Inset>
        </>
      )}

      {catalogOpen && (
        <ConnectionCatalogModal onClose={() => setCatalogOpen(false)} />
      )}

      {maintenance.updating && (
        <ConnectionUpdateCredentialDialog
          connection={maintenance.updating}
          onClose={maintenance.closeUpdate}
        />
      )}
    </div>
  );
}
