import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import { ListSection } from "@/components/ui/list-section";

import { AwsProfilesCallout } from "../../connections/components/aws-profiles-callout.js";
import { ConnectionGroup } from "../../connections/components/connection-group.js";
import { ConnectionMaintenanceDialog } from "../../connections/components/connection-update-credential-dialog.js";
import {
  GitHubAccountsCallout,
  type GrantDetails,
} from "../../connections/components/github-accounts-callout.js";
import { GrantRivalryCallout } from "../../connections/components/grant-rivalry-callout.js";
import { useConnectionMaintenance } from "../../connections/hooks/use-connection-maintenance.js";
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
}: Props) {
  const maintenance = useConnectionMaintenance();

  return (
    <>
      <GrantRivalryCallout granted={granted} className="mb-3" />
      {grants && onPreferConnection && (
        <>
          <GitHubAccountsCallout
            granted={granted}
            grants={grants}
            onPrefer={onPreferConnection}
            pending={preferPending}
            className="mb-3"
          />
          <AwsProfilesCallout
            granted={granted}
            grants={grants}
            onPrefer={onPreferConnection}
            pending={preferPending}
            className="mb-3"
          />
        </>
      )}
      {leading && <div className="mb-4">{leading}</div>}
      <ListSection
        label={title}
        onNew={onOpenCatalog}
        newTestId="open-connection-catalog"
        isEmpty={groups.length === 0 && !extraGroups}
        empty="No connections added to this agent yet."
      >
        {extraGroups}
        {groups.map((group) => (
          <ConnectionGroup
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
      </ListSection>
      <ConnectionMaintenanceDialog maintenance={maintenance} />
    </>
  );
}
