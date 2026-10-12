import type { SatelliteView } from "api-server-api";

import { Card } from "@/components/ui/card";

import { getBrand } from "../../../brand.js";
import type { RowGrantControls } from "../../connections/components/catalog-connection-row.js";
import { useRemoveSatelliteWithConfirm } from "../hooks/use-remove-satellite.js";
import { SatellitesGroup } from "./satellites-group.js";

interface Props {
  satellites: readonly SatelliteView[];
  grant?: (satellite: SatelliteView) => RowGrantControls;
}

export function CatalogSatellitesPane({ satellites, grant }: Props) {
  const { confirmAndRemove, removingName } = useRemoveSatelliteWithConfirm();
  const cli = getBrand().short;
  return (
    <>
      <Card className="overflow-hidden">
        <SatellitesGroup
          satellites={satellites}
          grant={grant}
          onRemove={(s) => void confirmAndRemove(s)}
          removingName={removingName}
        />
      </Card>
      <p className="text-sm text-muted-foreground">
        To connect another machine, run <code>{cli} satellite shell</code> or{" "}
        <code>{cli} satellite mcp</code> on it. It shows up here once it has
        connected.
      </p>
    </>
  );
}
