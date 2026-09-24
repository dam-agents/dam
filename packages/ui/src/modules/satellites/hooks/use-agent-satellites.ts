import type { SatelliteView } from "api-server-api";
import { useMemo } from "react";

import { emitToast } from "@/lib/toast";

import type { RowGrantControls } from "../../connections/components/catalog-connection-row.js";
import { useGrantSatellite, useRevokeSatellite } from "../api/mutations.js";
import { NO_SATELLITES, useSatellites } from "../api/queries.js";

export function useAgentSatellites(agentId: string) {
  const { data: satellites = NO_SATELLITES } = useSatellites();
  const grantSatellite = useGrantSatellite();
  const revokeSatellite = useRevokeSatellite();

  const granted = useMemo(
    () => satellites.filter((s) => s.grantedAgentIds.includes(agentId)),
    [satellites, agentId],
  );

  const grantControls = (satellite: SatelliteView): RowGrantControls => ({
    granted: satellite.grantedAgentIds.includes(agentId),
    onToggle: (on) => {
      const input = { satellite: satellite.name, agentId };
      if (!on) {
        revokeSatellite.mutate(input);
        return;
      }
      grantSatellite.mutate(input, {
        onSuccess: () =>
          emitToast({
            kind: "success",
            message: `Added ${satellite.name}. The agent picks up its tools when its harness next starts.`,
          }),
      });
    },
  });

  return { satellites, granted, grantControls };
}
