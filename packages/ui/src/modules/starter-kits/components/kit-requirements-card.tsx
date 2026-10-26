import { Information } from "@carbon/icons-react";
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
  const why = kit.connections.find((c) => c.required && c.note)?.note;
  const maintenance = useConnectionMaintenance();

  return (
    <div className="overflow-hidden rounded-lg border border-kit-line bg-kit-surface">
      {why && (
        <div className="px-4 py-3">
          <div className="flex items-start gap-2.5 rounded-lg bg-kit-tint px-3 py-2.5">
            <Information size={16} className="mt-0.5 shrink-0 text-kit" />
            <p className="text-sm text-foreground/80">
              {kit.name} needs {why}
            </p>
          </div>
        </div>
      )}

      <ul>
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
    </div>
  );
}
