import { Add } from "@carbon/icons-react";
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { ConnectionGroupCard } from "../../connections/components/connection-group-card.js";
import { ConnectionMaintenanceDialog } from "../../connections/components/connection-update-credential-dialog.js";
import { GrantRivalryCallout } from "../../connections/components/grant-rivalry-callout.js";
import { useConnectionMaintenance } from "../../connections/hooks/use-connection-maintenance.js";
import type { CatalogProviderGroup } from "../../connections/lib/catalog-providers.js";

interface Props {
  groups: CatalogProviderGroup[];
  granted: readonly ConnectionView[];
  templateById: Map<string, ConnectionTemplateView>;
  onToggleGrant: (id: string, on: boolean) => void;
  onOpenCatalog: () => void;
  title?: string;
  leading?: React.ReactNode;
}

export function GrantedConnectionsPanel({
  groups,
  granted,
  templateById,
  onToggleGrant,
  onOpenCatalog,
  title = "My connections",
  leading,
}: Props) {
  const maintenance = useConnectionMaintenance();

  const header = (
    <div className="mb-3 flex items-center justify-between">
      <SectionLabel>{title}</SectionLabel>
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenCatalog}
        data-testid="open-connection-catalog"
      >
        <Add size={16} />
        New
      </Button>
    </div>
  );
  const rivalryCallout = (
    <GrantRivalryCallout granted={granted} className="mb-3" />
  );

  if (groups.length === 0)
    return (
      <>
        {header}
        {rivalryCallout}
        {leading && <Inset className="flex flex-col gap-4">{leading}</Inset>}
        {!leading && (
          <EmptyStateCard
            message="You have not added any Connections to this Agent yet"
            actionLabel="Add Connection"
            onAction={onOpenCatalog}
          />
        )}
      </>
    );

  return (
    <>
      {header}
      {rivalryCallout}
      <Inset className="flex flex-col gap-4">
        {leading}
        {groups.map((group) => (
          <ConnectionGroupCard
            key={group.provider.id}
            group={group}
            templateById={templateById}
            showCount
            grant={(c) => ({
              granted: true,
              onToggle: (on) => onToggleGrant(c.id, on),
              actionHidden: true,
            })}
            onManage={onOpenCatalog}
            maintenance={maintenance.rowActions}
          />
        ))}
      </Inset>
      <ConnectionMaintenanceDialog maintenance={maintenance} />
    </>
  );
}
