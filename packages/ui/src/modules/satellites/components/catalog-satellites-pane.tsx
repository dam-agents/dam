import type { SatelliteView } from "api-server-api";

import type { RowGrantControls } from "../../connections/components/catalog-connection-row.js";
import { useRemoveSatelliteWithConfirm } from "../hooks/use-remove-satellite.js";
import { SatellitesGroupCard } from "./satellites-group-card.js";

interface Props {
  satellites: readonly SatelliteView[];
  grant?: (satellite: SatelliteView) => RowGrantControls;
}

export function CatalogSatellitesPane({ satellites, grant }: Props) {
  const { confirmAndRemove, removingName } = useRemoveSatelliteWithConfirm();
  return (
    <>
      <SatellitesGroupCard
        satellites={satellites}
        grant={grant}
        onRemove={(s) => void confirmAndRemove(s)}
        removingName={removingName}
      />
      <p className="text-sm text-muted-foreground">
        To connect another machine, run <code>dam satellite commands</code> or{" "}
        <code>dam satellite mcp</code> on it. It shows up here once it has
        connected.
      </p>
    </>
  );
}
