import { Satellite } from "@carbon/icons-react";
import type { SatelliteView } from "api-server-api";

import { PanelCard } from "@/components/ui/panel-card";

import type { RowGrantControls } from "../../connections/components/catalog-connection-row.js";
import { SatelliteRow } from "./satellite-row.js";
import { SatellitesExplainer } from "./satellites-explainer.js";

interface Props {
  satellites: readonly SatelliteView[];
  showCount?: boolean;
  grant?: (satellite: SatelliteView) => RowGrantControls | undefined;
  onRemove?: (satellite: SatelliteView) => void;
  removingName?: string | null;
}

export function SatellitesGroupCard({
  satellites,
  showCount = false,
  grant,
  onRemove,
  removingName = null,
}: Props) {
  return (
    <PanelCard
      testId="connection-group-satellites"
      title="Satellites"
      icon={<Satellite size={16} className="shrink-0 text-foreground/80" />}
      titleAccessory={
        <>
          <SatellitesExplainer />
          {showCount && (
            <span className="shrink-0 text-sm text-muted-foreground">
              {satellites.length} satellite{satellites.length === 1 ? "" : "s"}
            </span>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {satellites.map((s) => (
          <SatelliteRow
            key={s.name}
            satellite={s}
            grant={grant?.(s)}
            onRemove={onRemove && (() => onRemove(s))}
            removing={removingName === s.name}
          />
        ))}
      </div>
    </PanelCard>
  );
}
