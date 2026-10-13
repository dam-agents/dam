import type {
  ConnectionTemplateView,
  ConnectionView,
  StarterKitView,
} from "api-server-api";

import { ConnectionMaintenanceDialog } from "../../connections/components/connection-update-credential-dialog.js";
import { useConnectionMaintenance } from "../../connections/hooks/use-connection-maintenance.js";
import { accepts, connectionRequirements } from "../lib/setup.js";
import { KitRequirementRow } from "./kit-requirement-row.js";

interface Props {
  kit: StarterKitView;
  granted: readonly ConnectionView[];
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
  templates: readonly ConnectionTemplateView[];
  onRevoke: (connectionId: string) => void;
  onConnect: (accepts: readonly string[]) => void;
}

export function KitRequirementsCard({
  kit,
  granted,
  templateById,
  templates,
  onRevoke,
  onConnect,
}: Props) {
  const maintenance = useConnectionMaintenance();

  return (
    <>
      <ul className="flex flex-col gap-3">
        {connectionRequirements(kit).map((requirement) => (
          <KitRequirementRow
            key={requirement.accepts.join("|")}
            requirement={requirement}
            granted={granted.filter((c) =>
              accepts(requirement, c, templateById),
            )}
            templateById={templateById}
            templates={templates}
            maintenance={maintenance.rowActions}
            onRevoke={onRevoke}
            onConnect={onConnect}
          />
        ))}
      </ul>
      <ConnectionMaintenanceDialog maintenance={maintenance} />
    </>
  );
}
