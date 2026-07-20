import { Add } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useAppConnections } from "../api/queries.js";
import { ConnectionCatalogModal } from "../components/connection-catalog-modal.js";
import { ConnectionGroupCard } from "../components/connection-group-card.js";
import { useCatalogGroups } from "../hooks/use-catalog-groups.js";
import { useDisconnectConnection } from "../hooks/use-disconnect-connection.js";

export function ConnectionsView() {
  const connectionsQ = useAppConnections();
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const [catalogOpen, setCatalogOpen] = useState(false);

  const { populated: groups, templateById } = useCatalogGroups(
    connectionsQ.data ?? [],
  );

  const newButton = (
    <Button
      variant="outline"
      className="h-[32px] px-3 text-[14px] font-normal"
      onClick={() => setCatalogOpen(true)}
      data-testid="open-connection-catalog"
    >
      <Add size={16} />
      New
    </Button>
  );

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[24px] md:text-[28px] font-semibold tracking-[-0.65px] text-foreground">
          Connections
        </h1>
      </div>

      <p className="text-[14px] text-muted-foreground mb-8 leading-relaxed">
        Connections are the services and credentials your agents can reach.
      </p>

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
              />
            ))}
          </Inset>
        </>
      ) : (
        <>
          <SectionLabel spaced>My connections</SectionLabel>
          <Inset className="rounded-lg border border-border bg-card">
            <div className="flex flex-col items-center gap-4 py-10">
              <p className="text-[14px] text-foreground/80">
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
    </div>
  );
}
