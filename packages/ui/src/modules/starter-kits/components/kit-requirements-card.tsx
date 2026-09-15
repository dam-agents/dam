import { Information } from "@carbon/icons-react";
import type {
  ConnectionTemplateView,
  ConnectionView,
  StarterKitView,
} from "api-server-api";

import type { ConnectTarget, GrantedConnection } from "../lib/setup.js";
import { KitRequirementRow } from "./kit-requirement-row.js";

interface Props {
  kit: StarterKitView;
  owned: readonly GrantedConnection[];
  granted: readonly ConnectionView[];
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
  templates: readonly ConnectionTemplateView[];
  onUse: (connectionId: string) => void;
  onRevoke: (connectionId: string) => void;
  onConnect: (target: ConnectTarget) => void;
}

export function KitRequirementsCard({
  kit,
  owned,
  granted,
  templateById,
  templates,
  onUse,
  onRevoke,
  onConnect,
}: Props) {
  const why = kit.connections.find((c) => c.required && c.note)?.note;

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
        {kit.connections.map((requirement) => (
          <KitRequirementRow
            key={requirement.accepts.join("|")}
            requirement={requirement}
            owned={owned}
            granted={granted}
            templateById={templateById}
            templates={templates}
            onUse={onUse}
            onRevoke={onRevoke}
            onConnect={onConnect}
          />
        ))}
      </ul>
    </div>
  );
}
